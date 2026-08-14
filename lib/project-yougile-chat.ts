import { setProjectYougileChatId } from "@/lib/repositories/projects"
import {
  createProjectGroupChat,
  getGroupChat,
  getYouGileConfig,
  sendChatMessage,
  YouGileError,
} from "@/lib/yougile"

function chatTitle(projectName: string, writerEmail: string): string {
  const name = projectName.trim() || "Project"
  const email = writerEmail.trim()
  return email ? `${name} — ${email}` : name
}

async function createAndStoreChat(input: {
  projectId: string
  projectName: string
  writerEmail: string
}): Promise<string> {
  const config = getYouGileConfig()
  const chat = await createProjectGroupChat({
    title: chatTitle(input.projectName, input.writerEmail),
    botUserId: config.botUserId,
    memberIds: config.memberIds,
  })
  await setProjectYougileChatId(input.projectId, chat.id)
  return chat.id
}

/**
 * Returns a YouGile group chat the current API key can actually use.
 *
 * After rotating onto Chat Bot, old `yougile_chat_id` values still point at
 * chats that key cannot see — sending then fails silently. If the stored
 * chat is gone (404/403), we create a new one in this company:
 * title = "project name — writer email", members = YOUGILE_CHAT_MEMBER_IDS.
 */
export async function ensureProjectYouGileChat(input: {
  projectId: string
  projectName: string
  yougileChatId: string | null
  writerEmail: string
}): Promise<string> {
  if (input.yougileChatId) {
    const existing = await getGroupChat(input.yougileChatId)
    if (existing) {
      const have = existing.users ? new Set(Object.keys(existing.users)) : null
      if (have) {
        const { memberIds } = getYouGileConfig()
        const missing = memberIds.filter((id) => !have.has(id))
        if (missing.length === 0) return input.yougileChatId
      } else {
        return input.yougileChatId
      }
    }
  }
  return createAndStoreChat(input)
}

/** Posts a site chat message into YouGile, recreating the group chat if stale. */
export async function deliverProjectMessageToYouGile(input: {
  projectId: string
  projectName: string
  yougileChatId: string | null
  writerEmail: string
  text: string
}): Promise<string> {
  let chatId = await ensureProjectYouGileChat(input)
  try {
    const sent = await sendChatMessage({ chatId, text: input.text })
    return String(sent.id)
  } catch (error) {
    if (
      !(error instanceof YouGileError) ||
      (error.status !== 404 && error.status !== 403)
    ) {
      throw error
    }
    chatId = await createAndStoreChat(input)
    const sent = await sendChatMessage({ chatId, text: input.text })
    return String(sent.id)
  }
}
