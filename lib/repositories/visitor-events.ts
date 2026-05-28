import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"

export type VisitorEventInput = {
  path: string
  queryString?: string
  method?: string
  userId?: string | null
  userEmail?: string | null
  userFullName?: string | null
  fingerprint: string
  userAgent?: string
  ip?: string
  referer?: string
  language?: string
}

export type VisitorEventRow = {
  id: string
  path: string
  queryString: string
  method: string
  userId: string | null
  userEmail: string | null
  userFullName: string | null
  fingerprint: string
  userAgent: string
  ip: string
  referer: string
  language: string
  createdAt: Date
}

const SELECT_FIELDS = `
  id,
  path,
  query_string   AS "queryString",
  method,
  user_id        AS "userId",
  user_email     AS "userEmail",
  user_full_name AS "userFullName",
  fingerprint,
  user_agent     AS "userAgent",
  ip,
  referer,
  language,
  created_at     AS "createdAt"
`

export async function insertVisitorEvent(
  input: VisitorEventInput,
): Promise<void> {
  await query(
    `INSERT INTO visitor_events (
        id, path, query_string, method,
        user_id, user_email, user_full_name,
        fingerprint, user_agent, ip, referer, language
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      randomUUID(),
      input.path,
      input.queryString ?? "",
      input.method ?? "GET",
      input.userId ?? null,
      input.userEmail ?? null,
      input.userFullName ?? null,
      input.fingerprint,
      input.userAgent ?? "",
      input.ip ?? "",
      input.referer ?? "",
      input.language ?? "",
    ],
  )
}

export type VisitorListFilters = {
  search?: string
  audience?: "all" | "authenticated" | "anonymous"
  since?: Date
  limit?: number
  offset?: number
}

export async function listVisitorEvents(
  filters: VisitorListFilters = {},
): Promise<VisitorEventRow[]> {
  const where: string[] = []
  const params: unknown[] = []

  if (filters.audience === "authenticated") where.push(`user_id IS NOT NULL`)
  if (filters.audience === "anonymous") where.push(`user_id IS NULL`)

  if (filters.since) {
    params.push(filters.since)
    where.push(`created_at >= $${params.length}`)
  }

  if (filters.search && filters.search.trim()) {
    params.push(`%${filters.search.trim().toLowerCase()}%`)
    const idx = params.length
    where.push(
      `(lower(coalesce(user_email,''))   LIKE $${idx} OR
        lower(coalesce(user_full_name,'')) LIKE $${idx} OR
        lower(path)                       LIKE $${idx} OR
        lower(fingerprint)                LIKE $${idx})`,
    )
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""

  params.push(Math.min(Math.max(filters.limit ?? 100, 1), 500))
  const limitIdx = params.length
  params.push(Math.max(filters.offset ?? 0, 0))
  const offsetIdx = params.length

  const result = await query<VisitorEventRow>(
    `SELECT ${SELECT_FIELDS}
       FROM visitor_events
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  )
  return result.rows
}

export type VisitorStats = {
  totalLast24h: number
  uniqueLast24h: number
  authedLast24h: number
  total7d: number
  unique7d: number
  topPaths: { path: string; visits: number }[]
}

export async function getVisitorStats(): Promise<VisitorStats> {
  const result = await query<{
    total_last_24h: number
    unique_last_24h: number
    authed_last_24h: number
    total_7d: number
    unique_7d: number
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int   AS total_last_24h,
       COUNT(DISTINCT fingerprint) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS unique_last_24h,
       COUNT(DISTINCT user_id)     FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours' AND user_id IS NOT NULL)::int AS authed_last_24h,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int     AS total_7d,
       COUNT(DISTINCT fingerprint) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS unique_7d
     FROM visitor_events`,
  )
  const row = result.rows[0]

  const topResult = await query<{ path: string; visits: number }>(
    `SELECT path, COUNT(*)::int AS visits
       FROM visitor_events
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY path
      ORDER BY visits DESC, path ASC
      LIMIT 8`,
  )

  return {
    totalLast24h: row?.total_last_24h ?? 0,
    uniqueLast24h: row?.unique_last_24h ?? 0,
    authedLast24h: row?.authed_last_24h ?? 0,
    total7d: row?.total_7d ?? 0,
    unique7d: row?.unique_7d ?? 0,
    topPaths: topResult.rows,
  }
}

export type VisitorGroup = {
  key: string
  fingerprint: string
  userId: string | null
  userEmail: string | null
  userFullName: string | null
  userAgent: string
  ip: string
  language: string
  firstSeen: Date
  lastSeen: Date
  visits: number
  uniquePaths: number
  lastPath: string
}

/**
 * Groups visitor events into "sessions" by the most specific identifier we
 * have: user_id for logged-in users, fingerprint for anonymous ones. Returns
 * a single row per visitor with aggregate counters and freshly resolved
 * profile fields (we pick the most recent user_email/user_full_name we saw
 * for that key, which handles users that signed in mid-session).
 */
export async function listVisitorGroups(
  filters: Pick<VisitorListFilters, "search" | "audience" | "since"> & {
    limit?: number
  } = {},
): Promise<VisitorGroup[]> {
  const where: string[] = []
  const params: unknown[] = []

  if (filters.audience === "authenticated") where.push(`user_id IS NOT NULL`)
  if (filters.audience === "anonymous") where.push(`user_id IS NULL`)

  if (filters.since) {
    params.push(filters.since)
    where.push(`created_at >= $${params.length}`)
  }

  if (filters.search && filters.search.trim()) {
    params.push(`%${filters.search.trim().toLowerCase()}%`)
    const idx = params.length
    where.push(
      `(lower(coalesce(user_email,''))     LIKE $${idx} OR
        lower(coalesce(user_full_name,'')) LIKE $${idx} OR
        lower(path)                         LIKE $${idx} OR
        lower(fingerprint)                  LIKE $${idx})`,
    )
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""

  params.push(Math.min(Math.max(filters.limit ?? 100, 1), 500))
  const limitIdx = params.length

  const result = await query<{
    key: string
    fingerprint: string
    user_id: string | null
    user_email: string | null
    user_full_name: string | null
    user_agent: string
    ip: string
    language: string
    first_seen: Date
    last_seen: Date
    visits: number
    unique_paths: number
    last_path: string
  }>(
    `WITH events AS (
       SELECT
         COALESCE(user_id, fingerprint) AS key,
         fingerprint,
         user_id,
         user_email,
         user_full_name,
         user_agent,
         ip,
         language,
         path,
         created_at,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE(user_id, fingerprint)
           ORDER BY created_at DESC
         ) AS rn_desc
       FROM visitor_events
       ${whereSql}
     )
     SELECT
       key,
       MAX(fingerprint)    AS fingerprint,
       MAX(user_id)        AS user_id,
       MAX(user_email)     FILTER (WHERE rn_desc = 1) AS user_email,
       MAX(user_full_name) FILTER (WHERE rn_desc = 1) AS user_full_name,
       MAX(user_agent)     FILTER (WHERE rn_desc = 1) AS user_agent,
       MAX(ip)             FILTER (WHERE rn_desc = 1) AS ip,
       MAX(language)       FILTER (WHERE rn_desc = 1) AS language,
       MIN(created_at)     AS first_seen,
       MAX(created_at)     AS last_seen,
       COUNT(*)::int       AS visits,
       COUNT(DISTINCT path)::int AS unique_paths,
       MAX(path)           FILTER (WHERE rn_desc = 1) AS last_path
     FROM events
     GROUP BY key
     ORDER BY last_seen DESC
     LIMIT $${limitIdx}`,
    params,
  )

  return result.rows.map((r) => ({
    key: r.key,
    fingerprint: r.fingerprint,
    userId: r.user_id,
    userEmail: r.user_email,
    userFullName: r.user_full_name,
    userAgent: r.user_agent ?? "",
    ip: r.ip ?? "",
    language: r.language ?? "",
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    visits: r.visits,
    uniquePaths: r.unique_paths,
    lastPath: r.last_path ?? "",
  }))
}
