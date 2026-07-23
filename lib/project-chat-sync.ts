import {
  findProjectChatMessageByYougileId,
  insertProjectChatMessage,
  listProjectChatMessages,
} from "@/lib/repositories/project-chat"
import { getCompanyUserNameMap, getYouGileConfig, isYouGileConfigured, listChatMessages } from "@/lib/yougile"

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
 * company, shared across every open project chat tab polling this route —
 * fine at today's scale, but worth revisiting (e.g. a longer poll interval,
 * or a real push mechanism) if usage grows.
 */
export async function syncProjectChatFromYouGile(project: {
  id: string
  yougileChatId: string | null
}): Promise<void> {
  if (!project.yougileChatId || !isYouGileConfigured()) return

  try {
    const config = getYouGileConfig()
    const existing = await listProjectChatMessages(project.id)
    const lastKnownAt = existing.reduce<number>(
      (max, m) => Math.max(max, m.createdAt.getTime()),
      0,
    )

    const remote = await listChatMessages({
      chatId: project.yougileChatId,
      // A little slack so we never miss a message that landed in the same
      // millisecond as our last known one.
      sinceMs: lastKnownAt > 0 ? lastKnownAt - 1000 : undefined,
    })

    const newOnes = remote.filter(
      (m) => !(config.botUserId && m.fromUserId === config.botUserId),
    )
    if (newOnes.length === 0) return

    const names = await getCompanyUserNameMap()

    for (const m of newOnes) {
      const yougileMessageId = String(m.id)
      const already = await findProjectChatMessageByYougileId(yougileMessageId)
      if (already) continue

      await insertProjectChatMessage({
        projectId: project.id,
        senderType: "team",
        senderName: names.get(m.fromUserId) ?? "YouGile",
        body: m.text,
        yougileMessageId,
        delivered: true,
        createdAt: new Date(m.id),
      })
    }
  } catch (error) {
    console.error("[project-chat-sync] pull from YouGile failed", {
      projectId: project.id,
      error,
    })
  }
}
