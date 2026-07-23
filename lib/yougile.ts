const YOUGILE_API_BASE = "https://yougile.com/api-v2"

export class YouGileError extends Error {
  readonly status: number
  readonly payload?: unknown

  constructor(message: string, status: number, payload?: unknown) {
    super(message)
    this.name = "YouGileError"
    this.status = status
    this.payload = payload
  }
}

type YouGileConfig = {
  apiKey: string
  botUserId?: string
  memberIds: string[]
  webhookSecret?: string
}

/** Parses the comma-separated YOUGILE_CHAT_MEMBER_IDS env var. */
function parseMemberIds(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
}

export function getYouGileConfig(): YouGileConfig {
  const apiKey = process.env.YOUGILE_API_KEY?.trim()
  if (!apiKey) {
    throw new YouGileError("YOUGILE_API_KEY is not configured.", 500)
  }

  return {
    apiKey,
    botUserId: process.env.YOUGILE_BOT_USER_ID?.trim() || undefined,
    memberIds: parseMemberIds(process.env.YOUGILE_CHAT_MEMBER_IDS),
    webhookSecret: process.env.YOUGILE_WEBHOOK_SECRET?.trim() || undefined,
  }
}

export function isYouGileConfigured(): boolean {
  return !!process.env.YOUGILE_API_KEY?.trim()
}

async function yougileRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const { apiKey } = getYouGileConfig()
  const response = await fetch(`${YOUGILE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "message" in payload &&
      typeof (payload as { message?: unknown }).message === "string"
        ? (payload as { message: string }).message
        : `YouGile API error (HTTP ${response.status}).`
    throw new YouGileError(message, response.status, payload)
  }

  return payload as T
}

export type YouGileGroupChat = {
  id: string
}

/**
 * Creates a group chat for a project. Members are passed as a userId ->
 * role map, per YouGile's CreateGroupChatDto; every listed member (site bot
 * + team members from YOUGILE_CHAT_MEMBER_IDS) gets the plain "user" role —
 * there's no need for anyone to be an admin of a per-project chat.
 */
export async function createProjectGroupChat(input: {
  title: string
  memberIds: string[]
}): Promise<YouGileGroupChat> {
  const users: Record<string, string> = {}
  for (const id of input.memberIds) {
    users[id] = "user"
  }

  return yougileRequest<YouGileGroupChat>("/groupChats", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      users,
    }),
  })
}

export type YouGileChatMessage = {
  id: string
}

/** Sends a text message into an existing YouGile group chat. */
export async function sendChatMessage(input: {
  chatId: string
  text: string
  textHtml?: string
  label?: string
}): Promise<YouGileChatMessage> {
  return yougileRequest<YouGileChatMessage>("/chatMessages", {
    method: "POST",
    body: JSON.stringify({
      chatId: input.chatId,
      text: input.text,
      textHtml: input.textHtml ?? input.text,
      label: input.label ?? "site-chat",
    }),
  })
}

export type YouGileWebhookSubscription = {
  id: string
}

/** One-off setup helper: registers a webhook subscription for an event type. */
export async function createWebhookSubscription(input: {
  url: string
  event: string
}): Promise<YouGileWebhookSubscription> {
  return yougileRequest<YouGileWebhookSubscription>("/webhooks", {
    method: "POST",
    body: JSON.stringify({
      url: input.url,
      event: input.event,
    }),
  })
}

export type YouGileUser = {
  id: string
  email?: string
  realName?: string
}

/** Lists company users — used by scripts/yougile-list-users.mjs. */
export async function listCompanyUsers(): Promise<YouGileUser[]> {
  const result = await yougileRequest<{ content?: YouGileUser[] } | YouGileUser[]>(
    "/users",
    { method: "GET" },
  )
  return Array.isArray(result) ? result : result.content ?? []
}

/**
 * Builds the member list for a freshly created project group chat: the site
 * bot (if configured) plus every team member id from
 * YOUGILE_CHAT_MEMBER_IDS, deduplicated.
 */
export function resolveProjectChatMemberIds(config: YouGileConfig): string[] {
  const ids = new Set<string>(config.memberIds)
  if (config.botUserId) ids.add(config.botUserId)
  return [...ids]
}
