import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type { VideoRecord } from "@/lib/domain-types"

const VIDEO_FIELDS = `
  id,
  title,
  description,
  thumbnail,
  video_url AS "videoUrl",
  duration,
  category,
  is_published AS "isPublished",
  sort_order AS "sortOrder",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

export async function listVideos(): Promise<VideoRecord[]> {
  const result = await query<VideoRecord>(
    `SELECT ${VIDEO_FIELDS} FROM videos ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows
}

export async function listPublishedVideos(): Promise<VideoRecord[]> {
  const result = await query<VideoRecord>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE is_published = true
      ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows
}

export async function findPublishedVideoById(
  id: string,
): Promise<VideoRecord | null> {
  const result = await query<VideoRecord>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE id = $1 AND is_published = true`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function listRelatedPublishedVideos(
  excludeId: string,
  limit = 3,
): Promise<VideoRecord[]> {
  const result = await query<VideoRecord>(
    `SELECT ${VIDEO_FIELDS}
       FROM videos
      WHERE is_published = true AND id <> $1
      ORDER BY sort_order ASC, created_at ASC
      LIMIT $2`,
    [excludeId, limit],
  )
  return result.rows
}

export async function createVideo(input: {
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  category: string
  isPublished: boolean
}): Promise<VideoRecord> {
  const id = randomUUID()
  const max = await query<{ max: number | null }>(
    `SELECT MAX(sort_order) AS max FROM videos`,
  )
  const nextSortOrder = (max.rows[0]?.max ?? 0) + 10

  const result = await query<VideoRecord>(
    `INSERT INTO videos (
        id, title, description, thumbnail, video_url, duration, category,
        is_published, sort_order
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${VIDEO_FIELDS}`,
    [
      id,
      input.title,
      input.description,
      input.thumbnail,
      input.videoUrl,
      input.duration,
      input.category,
      input.isPublished,
      nextSortOrder,
    ],
  )
  return result.rows[0]
}

export async function updateVideo(
  id: string,
  input: Partial<{
    title: string
    description: string
    thumbnail: string
    videoUrl: string
    duration: string
    category: string
    isPublished: boolean
  }>,
): Promise<VideoRecord | null> {
  const result = await query<VideoRecord>(
    `UPDATE videos
        SET title        = COALESCE($2, title),
            description  = COALESCE($3, description),
            thumbnail    = COALESCE($4, thumbnail),
            video_url    = COALESCE($5, video_url),
            duration     = COALESCE($6, duration),
            category     = COALESCE($7, category),
            is_published = COALESCE($8, is_published),
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
      input.category ?? null,
      input.isPublished ?? null,
    ],
  )
  return result.rows[0] ?? null
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
