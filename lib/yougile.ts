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
 * Per-role permission bundle referenced by CreateGroupChatDto.roleConfigMap —
 * mirrors YouGile's own doc example. "admin" (the site bot) keeps full
 * control of the chat; "user" (invited team members) can chat but not
 * manage the chat itself.
 */
const GROUP_CHAT_ROLE_CONFIG_MAP = {
  admin: {
    editProperties: true,
    editAdmins: true,
    editUsers: true,
    sendMessages: true,
    removeMessages: true,
  },
  user: {
    editProperties: false,
    editAdmins: false,
    editUsers: true,
    sendMessages: true,
    removeMessages: false,
  },
}

/**
 * Creates a group chat for a project. Confirmed against YouGile's real
 * OpenAPI spec (https://yougile.com/api-json, CreateGroupChatDto): the
 * endpoint is `/group-chats` (not `/groupChats`), and besides `users` it
 * requires `userRoleMap` (userId -> role name) and `roleConfigMap` (role
 * name -> permission flags) — a flat `users: { id: role }` map alone is
 * rejected with a 400.
 */
export async function createProjectGroupChat(input: {
  title: string
  /** Site bot's YouGile user id — gets the "admin" role in the new chat. */
  botUserId?: string
  /** Team members added to the chat — get the "user" role. */
  memberIds: string[]
}): Promise<YouGileGroupChat> {
  const users: Record<string, { notified: boolean }> = {}
  const userRoleMap: Record<string, string> = {}

  if (input.botUserId) {
    users[input.botUserId] = { notified: true }
    userRoleMap[input.botUserId] = "admin"
  }
  for (const id of input.memberIds) {
    if (id === input.botUserId) continue
    users[id] = { notified: true }
    userRoleMap[id] = "user"
  }

  return yougileRequest<YouGileGroupChat>("/group-chats", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      users,
      userRoleMap,
      roleConfigMap: GROUP_CHAT_ROLE_CONFIG_MAP,
    }),
  })
}

export type YouGileChatMessage = {
  /** YouGile message ids are numeric (a timestamp) — stored as text in our DB. */
  id: number
}

/**
 * Sends a text message into an existing YouGile chat. Confirmed against the
 * real spec: the endpoint is `/chats/{chatId}/messages` (not a flat
 * `/chatMessages` with `chatId` in the body).
 */
export async function sendChatMessage(input: {
  chatId: string
  text: string
  textHtml?: string
  label?: string
}): Promise<YouGileChatMessage> {
  return yougileRequest<YouGileChatMessage>(
    `/chats/${encodeURIComponent(input.chatId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        text: input.text,
        textHtml: input.textHtml ?? input.text,
        label: input.label ?? "site-chat",
      }),
    },
  )
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
      // Required by CreateWebhookDto's schema; empty = no extra filtering.
      filters: [],
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

/** The YouGile user that owns the currently configured API key. */
export async function getCurrentYouGileUser(): Promise<YouGileUser> {
  return yougileRequest<YouGileUser>("/users/me", { method: "GET" })
}
