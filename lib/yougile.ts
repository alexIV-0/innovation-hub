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
  /** Company the API key belongs to — chats are created in this company. */
  companyId?: string
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
    companyId: process.env.YOUGILE_COMPANY_ID?.trim() || undefined,
    botUserId: process.env.YOUGILE_BOT_USER_ID?.trim() || undefined,
    memberIds: parseMemberIds(process.env.YOUGILE_CHAT_MEMBER_IDS),
    webhookSecret: process.env.YOUGILE_WEBHOOK_SECRET?.trim() || undefined,
  }
}

function yougileErrorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === "string" && message.trim()) return message
    if (Array.isArray(message) && message.length > 0) return message.map(String).join("; ")
  }
  return `YouGile API error (HTTP ${status}).`
}

export function isYouGileConfigured(): boolean {
  return !!process.env.YOUGILE_API_KEY?.trim()
}

/**
 * Hard cap on any single YouGile round-trip. Without it a hung upstream
 * keeps the request (and whatever page/API handler awaits it) open until
 * the platform's own socket timeout, which can be minutes.
 */
const YOUGILE_REQUEST_TIMEOUT_MS = 10_000

function describeFetchFailure(error: unknown): string {
  const chain: unknown[] = [error]
  if (error && typeof error === "object" && "cause" in error) {
    chain.push((error as { cause: unknown }).cause)
  }
  for (const item of chain) {
    if (!item || typeof item !== "object") continue
    const code = "code" in item ? String((item as { code: unknown }).code) : ""
    const hostname =
      "hostname" in item ? String((item as { hostname: unknown }).hostname) : ""
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      return `DNS lookup failed for ${hostname || "yougile.com"}`
    }
    if (
      code === "ECONNREFUSED" ||
      code === "ECONNRESET" ||
      code === "ETIMEDOUT" ||
      code === "ENETUNREACH" ||
      code === "EHOSTUNREACH"
    ) {
      return code
    }
    const name = "name" in item ? String((item as { name: unknown }).name) : ""
    if (name === "TimeoutError" || name === "AbortError") return "request timed out"
  }
  return error instanceof Error ? error.message : "network error"
}

/** DNS / timeout / connection failures, plus upstream 429/5xx — retry later, don't dump a stack. */
export function isYouGileTransientError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: unknown }).status)
    if (status === 0 || status === 429 || status >= 500) return true
  }
  if (error instanceof TypeError && /fetch failed/i.test(error.message)) return true
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return true
  }
  return false
}

async function yougileRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const { apiKey } = getYouGileConfig()
  let response: Response
  try {
    response = await fetch(`${YOUGILE_API_BASE}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(YOUGILE_REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    throw new YouGileError(
      `YouGile unreachable: ${describeFetchFailure(error)}`,
      0,
      error,
    )
  }

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new YouGileError(yougileErrorMessage(payload, response.status), response.status, payload)
  }

  return payload as T
}

export type YouGileGroupChat = {
  id: string
  title?: string
  users?: Record<string, { notified?: boolean }>
}

/** Returns null when this API key cannot see the chat (deleted or other company/user). */
export async function getGroupChat(chatId: string): Promise<YouGileGroupChat | null> {
  try {
    return await yougileRequest<YouGileGroupChat>(
      `/group-chats/${encodeURIComponent(chatId)}`,
      { method: "GET" },
    )
  } catch (error) {
    if (error instanceof YouGileError && (error.status === 404 || error.status === 403)) {
      return null
    }
    throw error
  }
}

/**
 * Roles for a project group chat in the YouGile company.
 * `owner` = site bot (posts the user's site messages).
 * `admin` = YOUGILE_CHAT_MEMBER_IDS — they must be able to reply in this chat.
 */
const GROUP_CHAT_ROLE_CONFIG_MAP = {
  owner: {
    editProperties: true,
    editAdmins: true,
    editUsers: true,
    sendMessages: true,
    removeMessages: true,
  },
  admin: {
    editProperties: false,
    editAdmins: false,
    editUsers: false,
    sendMessages: true,
    removeMessages: false,
  },
}

/**
 * Creates a group chat in the YouGile company of YOUGILE_API_KEY.
 * Title is "project name — writer email". Bot posts site messages;
 * YOUGILE_CHAT_MEMBER_IDS are added with sendMessages so they can reply.
 */
export async function createProjectGroupChat(input: {
  title: string
  /** Site bot — posts the user's site messages into this chat. */
  botUserId?: string
  /** Team members who can reply in YouGile (YOUGILE_CHAT_MEMBER_IDS). */
  memberIds: string[]
}): Promise<YouGileGroupChat> {
  const users: Record<string, { notified: boolean }> = {}
  const userRoleMap: Record<string, string> = {}

  if (input.botUserId) {
    users[input.botUserId] = { notified: true }
    userRoleMap[input.botUserId] = "owner"
  }
  for (const id of input.memberIds) {
    if (id === input.botUserId) continue
    users[id] = { notified: true }
    userRoleMap[id] = "admin"
  }

  if (Object.keys(users).length === 0) {
    throw new YouGileError(
      "Set YOUGILE_BOT_USER_ID and YOUGILE_CHAT_MEMBER_IDS so the project chat has members.",
      500,
    )
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
}): Promise<YouGileChatMessage> {
  // Do not send `label`: YouGile treats it as a "быстрая ссылка" and pins
  // every labelled message at the top of the chat (we used to pass
  // "site-chat", which produced a pin per site message).
  return yougileRequest<YouGileChatMessage>(
    `/chats/${encodeURIComponent(input.chatId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        text: input.text,
        textHtml: input.textHtml ?? input.text,
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

export type YouGileRemoteChatMessage = {
  /** Numeric epoch-ms timestamp — also YouGile's message id. */
  id: number
  fromUserId: string
  text: string
  textHtml?: string
  label?: string
}

/**
 * Lists messages in a chat, confirmed against the real spec
 * (`GET /chats/{chatId}/messages`, query params `since`/`limit`/`offset`).
 *
 * IMPORTANT: YouGile's `chat_message-created` webhook only fires for
 * messages sent through the REST API — messages typed by humans directly
 * in the YouGile app never trigger it (confirmed empirically: a real
 * multi-message conversation left `lastSuccess` on the webhook subscription
 * frozen at the one API-sent message, with zero deliveries for the rest).
 * So this function, not the webhook, is what actually pulls team replies
 * into the site — see `lib/project-chat-sync.ts`.
 */
export async function listChatMessages(input: {
  chatId: string
  /** Only messages created strictly after this epoch-ms timestamp. */
  sinceMs?: number
  limit?: number
}): Promise<YouGileRemoteChatMessage[]> {
  const params = new URLSearchParams()
  params.set("limit", String(input.limit ?? 200))
  if (input.sinceMs) params.set("since", String(input.sinceMs))

  const result = await yougileRequest<{ content?: YouGileRemoteChatMessage[] }>(
    `/chats/${encodeURIComponent(input.chatId)}/messages?${params.toString()}`,
    { method: "GET" },
  )
  return result.content ?? []
}

let userNameCache: { at: number; byId: Map<string, string> } | null = null
const USER_NAME_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Maps YouGile user id -> display name, cached for a few minutes (company
 * rosters change rarely) since this is looked up on every chat poll to
 * label incoming "team" messages.
 */
export async function getCompanyUserNameMap(): Promise<Map<string, string>> {
  const now = Date.now()
  if (userNameCache && now - userNameCache.at < USER_NAME_CACHE_TTL_MS) {
    return userNameCache.byId
  }
  const users = await listCompanyUsers()
  const byId = new Map(users.map((u) => [u.id, u.realName || u.email || "YouGile"]))
  userNameCache = { at: now, byId }
  return byId
}
