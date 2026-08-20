import { isPushConfigured, sendPushToUser } from "@/lib/push"
import {
  filterExistingYougileMessageIds,
  insertProjectChatMessage,
  listProjectChatMessages,
} from "@/lib/repositories/project-chat"
import { clearProjectYougileChatId } from "@/lib/repositories/projects"
import {
  getCompanyUserNameMap,
  getYouGileConfig,
  isYouGileConfigured,
  listChatMessages,
  YouGileError,
} from "@/lib/yougile"

/** Chat ids YouGile already said are gone — skip further pulls this process. */
const missingYouGileChatIds = new Set<string>()

/**
 * Pulls team replies from a project's YouGile chat into the site's DB.
 *
 * This exists because YouGile's `chat_message-created` webhook only fires
 * for messages sent through the REST API — messages a team member types
 * directly in the YouGile app never trigger it (confirmed empirically: in
 * a real test conversation, only the one message the site sent via the API
 * showed up as a successful webhook delivery; eleven follow-up messages
 * typed in the YouGile UI produced zero webhook calls). So instead of
 * waiting for pushes, the site pulls: called from the chat GET route that
 * the browser already polls every ~6s, it fetches anything newer than the
 * last message we know about and stores it as `sender_type: 'team'`
 * (skipping the site's own bot so its already-stored messages aren't
 * duplicated).
 *
 * Known limitation: YouGile caps the API at 50 requests/minute per
 * company, shared across every open project chat tab polling this route
 * plus the background poller (see lib/chat-push-poller.ts) — fine at
 * today's scale, but worth revisiting (longer intervals, batching) if the
 * number of active linked projects grows a lot.
 *
 * Whenever this pulls in new team messages it also fires a Web Push
 * notification to the project owner (one push per sync call, not one per
 * message, so a batch of backlog replies doesn't spam their device) — see
 * lib/push.ts. This is also why a background poller matters: without it,
 * pushes would only ever fire while someone happens to have a page open
 * that triggers a sync.
 */
export async function syncProjectChatFromYouGile(project: {
  id: string
  userId: string
  name: string
  yougileChatId: string | null
}): Promise<void> {
  const chatId = project.yougileChatId
  if (!chatId || !isYouGileConfigured()) return
  if (missingYouGileChatIds.has(chatId)) return

  try {
    const config = getYouGileConfig()
    const existing = await listProjectChatMessages(project.id)
    // Cursor is YouGile's own message id (epoch-ms), not our created_at —
    // site-clock skew would otherwise skip replies typed in the YouGile app.
    const lastKnownAt = existing.reduce<number>((max, m) => {
      if (!m.yougileMessageId) return max
      const ts = Number(m.yougileMessageId)
      return Number.isFinite(ts) ? Math.max(max, ts) : max
    }, 0)

    const remote = await listChatMessages({
      chatId,
      // A little slack so we never miss a message that landed in the same
      // millisecond as our last known one.
      sinceMs: lastKnownAt > 0 ? lastKnownAt - 1000 : undefined,
    })

    const newOnes = remote.filter(
      (m) => !(config.botUserId && m.fromUserId === config.botUserId),
    )
    if (newOnes.length === 0) return

    // One batched dedup query for the whole pull instead of a round-trip
    // per remote message (the old N+1 dominated backlog syncs).
    const [names, alreadyStored] = await Promise.all([
      getCompanyUserNameMap(),
      filterExistingYougileMessageIds(newOnes.map((m) => String(m.id))),
    ])
    const inserted: { senderName: string; body: string }[] = []

    for (const m of newOnes) {
      const yougileMessageId = String(m.id)
      if (alreadyStored.has(yougileMessageId)) continue

      const senderName = names.get(m.fromUserId) ?? "YouGile"
      await insertProjectChatMessage({
        projectId: project.id,
        senderType: "team",
        senderName,
        body: m.text,
        yougileMessageId,
        delivered: true,
        createdAt: new Date(m.id),
      })
      inserted.push({ senderName, body: m.text })
    }

    if (inserted.length > 0 && isPushConfigured()) {
      const last = inserted[inserted.length - 1]
      await sendPushToUser(project.userId, {
        title: project.name,
        body:
          inserted.length === 1
            ? `${last.senderName}: ${last.body}`
            : `${inserted.length} new replies — latest from ${last.senderName}`,
        url: `/account/projects/${project.id}/chat`,
      }).catch((error) => {
        console.error("[project-chat-sync] push notification failed", {
          projectId: project.id,
          error,
        })
      })
    }
  } catch (error) {
    if (error instanceof YouGileError && (error.status === 404 || error.status === 403)) {
      // Chat/task was deleted in YouGile (or this API key cannot see it).
      // Unlink so the 30s poller stops retrying; the next site message
      // recreates a group chat via ensureProjectYouGileChat.
      missingYouGileChatIds.add(chatId)
      console.warn(
        `[project-chat-sync] YouGile chat gone, unlinking project ${project.id} (${chatId})`,
      )
      await clearProjectYougileChatId(project.id).catch((clearError) => {
        console.error("[project-chat-sync] failed to unlink missing YouGile chat", {
          projectId: project.id,
          error: clearError,
        })
      })
      return
    }
    console.error("[project-chat-sync] pull from YouGile failed", {
      projectId: project.id,
      error,
    })
  }
}
