import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type { VideoRecord } from "@/lib/domain-types"
import { normalizeTags, primaryTag } from "@/lib/tags"
import { normalizeMediaDisplayUrl } from "@/lib/s3-config"

const VIDEO_FIELDS = `
  id,
  title,
  description,
  thumbnail,
  video_url AS "videoUrl",
  duration,
  tags,
  category,
  is_published AS "isPublished",
  sort_order AS "sortOrder",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

type VideoRow = Omit<VideoRecord, "category"> & { category?: string }

function mapVideoRow(video: VideoRow): VideoRecord {
  const tags =
    Array.isArray(video.tags) && video.tags.length > 0
      ? normalizeTags(video.tags)
      : video.category
        ? normalizeTags([video.category])
        : []
  return {
    ...video,
    tags,
    category: primaryTag(tags) || video.category || "",
    thumbnail: normalizeMediaDisplayUrl(video.thumbnail),
    videoUrl: normalizeMediaDisplayUrl(video.videoUrl),
  }
}

export type VideoListCursor = {
  sortOrder: number
  createdAt: string
  id: string
}

export type PaginatedVideosResult = {
  items: VideoRecord[]
  nextCursor: string | null
}

function encodeCursor(cursor: VideoListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

export function decodeVideoCursor(raw: string | null | undefined): VideoListCursor | null {
  if (!raw?.trim()) return null
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as VideoListCursor
    if (
      typeof parsed.sortOrder === "number" &&
      typeof parsed.createdAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

export async function listVideos(): Promise<VideoRecord[]> {
  const result = await query<VideoRow>(
    `SELECT ${VIDEO_FIELDS} FROM videos ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows.map(mapVideoRow)
}

export async function listPublishedVideos(): Promise<VideoRecord[]> {
  const result = await query<VideoRow>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE is_published = true
      ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows.map(mapVideoRow)
}

export async function listPublishedVideosPaginated(input: {
  limit?: number
  cursor?: VideoListCursor | null
  tags?: string[]
  q?: string
}): Promise<PaginatedVideosResult> {
  const limit = Math.min(Math.max(input.limit ?? 9, 1), 48)
  const cursor = input.cursor ?? null
  const filterTags = input.tags?.length ? normalizeTags(input.tags) : []
  const search = input.q?.trim().toLowerCase() ?? ""

  const conditions = ["is_published = true"]
  const params: unknown[] = []
  let paramIndex = 1

  if (filterTags.length > 0) {
    conditions.push(`tags && $${paramIndex}::text[]`)
    params.push(filterTags)
    paramIndex++
  }

  if (search) {
    conditions.push(
      `(LOWER(title) LIKE $${paramIndex}
        OR LOWER(description) LIKE $${paramIndex}
        OR EXISTS (
          SELECT 1 FROM unnest(tags) AS t WHERE LOWER(t) LIKE $${paramIndex}
        ))`,
    )
    params.push(`%${search}%`)
    paramIndex++
  }

  if (cursor) {
    conditions.push(
      `(sort_order, created_at, id) > ($${paramIndex}, $${paramIndex + 1}::timestamptz, $${paramIndex + 2})`,
    )
    params.push(cursor.sortOrder, cursor.createdAt, cursor.id)
    paramIndex += 3
  }

  params.push(limit + 1)
  const where = conditions.join(" AND ")

  const result = await query<VideoRow>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE ${where}
      ORDER BY sort_order ASC, created_at ASC, id ASC
      LIMIT $${paramIndex}`,
    params,
  )

  const rows = result.rows.map(mapVideoRow)
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          sortOrder: last.sortOrder,
          createdAt: last.createdAt.toISOString(),
          id: last.id,
        })
      : null

  return { items, nextCursor }
}

export type TagCount = { tag: string; count: number }

export async function listPublishedVideoTagCounts(): Promise<TagCount[]> {
  const result = await query<{ tag: string; count: string }>(
    `SELECT t AS tag, COUNT(*)::text AS count
       FROM videos v, unnest(v.tags) AS t
      WHERE v.is_published = true AND t <> ''
      GROUP BY t
      ORDER BY count DESC, t ASC`,
  )
  return result.rows.map((row) => ({
    tag: row.tag,
    count: Number.parseInt(row.count, 10) || 0,
  }))
}

export async function findPublishedVideoById(
  id: string,
): Promise<VideoRecord | null> {
  const result = await query<VideoRow>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE id = $1 AND is_published = true`,
    [id],
  )
  const video = result.rows[0]
  return video ? mapVideoRow(video) : null
}

export async function listRelatedPublishedVideos(
  excludeId: string,
  limit = 3,
): Promise<VideoRecord[]> {
  const result = await query<VideoRow>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE is_published = true AND id <> $1
      ORDER BY sort_order ASC, created_at ASC
      LIMIT $2`,
    [excludeId, limit],
  )
  return result.rows.map(mapVideoRow)
}

export async function createVideo(input: {
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  isPublished: boolean
}): Promise<VideoRecord> {
  const id = randomUUID()
  const tags = normalizeTags(input.tags)
  const category = primaryTag(tags)
  const result = await query<VideoRow>(
    `INSERT INTO videos (
        id, title, description, thumbnail, video_url, duration, tags, category,
        is_published, sort_order
     ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM videos)
     )
     RETURNING ${VIDEO_FIELDS}`,
    [
      id,
      input.title,
      input.description,
      input.thumbnail,
      input.videoUrl,
      input.duration,
      tags,
      category,
      input.isPublished,
    ],
  )
  return mapVideoRow(result.rows[0])
}

export async function updateVideo(
  id: string,
  input: Partial<{
    title: string
    description: string
    thumbnail: string
    videoUrl: string
    duration: string
    tags: string[]
    isPublished: boolean
  }>,
): Promise<VideoRecord | null> {
  const tags =
    input.tags !== undefined ? normalizeTags(input.tags) : undefined
  const category = tags !== undefined ? primaryTag(tags) : null

  const result = await query<VideoRow>(
    `UPDATE videos
        SET title        = COALESCE($2, title),
            description  = COALESCE($3, description),
            thumbnail    = COALESCE($4, thumbnail),
            video_url    = COALESCE($5, video_url),
            duration     = COALESCE($6, duration),
            tags         = COALESCE($7, tags),
            category     = COALESCE($8, category),
            is_published = COALESCE($9, is_published),
            updated_at   = NOW()
      WHERE id = $1
      RETURNING ${VIDEO_FIELDS}`,
    [
      id,
      input.title ?? null,
      input.description ?? null,
      input.thumbnail ?? null,
      input.videoUrl ?? null,
      input.duration ?? null,
      tags ?? null,
      category,
      input.isPublished ?? null,
    ],
  )
  const video = result.rows[0]
  return video ? mapVideoRow(video) : null
}

export async function deleteVideo(id: string) {
  await query(`DELETE FROM videos WHERE id = $1`, [id])
}

export type ReorderResult = "ok" | "not_found" | "boundary"

export async function reorderVideo(
  id: string,
  direction: "up" | "down",
): Promise<ReorderResult> {
  return withTransaction(async (client) => {
    const allRes = await client.query<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM videos
        ORDER BY sort_order ASC, created_at ASC`,
    )
    const all = allRes.rows
    const index = all.findIndex((row) => row.id === id)
    if (index === -1) return "not_found"

    const swapIndex = direction === "up" ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= all.length) return "boundary"

    const current = all[index]
    const target = all[swapIndex]

    await client.query(
      `UPDATE videos SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
      [current.id, target.sort_order],
    )
    await client.query(
      `UPDATE videos SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
      [target.id, current.sort_order],
    )

    return "ok"
  })
}

export async function reorderVideosBulk(ids: string[]): Promise<VideoRecord[]> {
  return withTransaction(async (client) => {
    const publishedRes = await client.query<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM videos
        WHERE is_published = true
        ORDER BY sort_order ASC, created_at ASC`,
    )
    const published = publishedRes.rows
    if (ids.length !== published.length) {
      throw new Error("INVALID_REORDER_LENGTH")
    }

    const publishedIds = new Set(published.map((row) => row.id))
    if (!ids.every((id) => publishedIds.has(id))) {
      throw new Error("INVALID_REORDER_IDS")
    }

    const draftRes = await client.query<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM videos
        WHERE is_published = false
        ORDER BY sort_order ASC, created_at ASC`,
    )
    const drafts = draftRes.rows

    let order = 10
    for (const id of ids) {
      await client.query(
        `UPDATE videos SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
        [id, order],
      )
      order += 10
    }
    for (const draft of drafts) {
      await client.query(
        `UPDATE videos SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
        [draft.id, order],
      )
      order += 10
    }

    const result = await client.query<VideoRow>(
      `SELECT ${VIDEO_FIELDS} FROM videos ORDER BY sort_order ASC, created_at ASC`,
    )
    return result.rows.map(mapVideoRow)
  })
}
