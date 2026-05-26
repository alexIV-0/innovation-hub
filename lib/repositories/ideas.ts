import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type { IdeaRecord } from "@/lib/domain-types"
import type { ReorderResult } from "@/lib/repositories/videos"
import { normalizeTags, primaryTag } from "@/lib/tags"
import { normalizeMediaDisplayUrl } from "@/lib/s3-config"

const IDEA_FIELDS = `
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

type IdeaRow = Omit<IdeaRecord, "category"> & { category?: string }

function mapIdeaRow(idea: IdeaRow): IdeaRecord {
  const tags =
    Array.isArray(idea.tags) && idea.tags.length > 0
      ? normalizeTags(idea.tags)
      : idea.category
        ? normalizeTags([idea.category])
        : []
  return {
    ...idea,
    tags,
    category: primaryTag(tags) || idea.category || "",
    thumbnail: idea.thumbnail
      ? normalizeMediaDisplayUrl(idea.thumbnail)
      : "",
    videoUrl: idea.videoUrl
      ? normalizeMediaDisplayUrl(idea.videoUrl)
      : "",
  }
}

export async function listIdeas(): Promise<IdeaRecord[]> {
  const result = await query<IdeaRow>(
    `SELECT ${IDEA_FIELDS} FROM ideas ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows.map(mapIdeaRow)
}

export async function listPublishedIdeas(): Promise<IdeaRecord[]> {
  const result = await query<IdeaRow>(
    `SELECT ${IDEA_FIELDS}
       FROM ideas
      WHERE is_published = true
      ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows.map(mapIdeaRow)
}

export async function createIdea(input: {
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  isPublished: boolean
}): Promise<IdeaRecord> {
  const id = randomUUID()
  const tags = normalizeTags(input.tags)
  const category = primaryTag(tags)
  const result = await query<IdeaRow>(
    `INSERT INTO ideas (
        id, title, description, thumbnail, video_url, duration, tags, category,
        is_published, sort_order
     ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM ideas)
     )
     RETURNING ${IDEA_FIELDS}`,
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
  return mapIdeaRow(result.rows[0])
}

export async function updateIdea(
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
): Promise<IdeaRecord | null> {
  const tags =
    input.tags !== undefined ? normalizeTags(input.tags) : undefined
  const category = tags !== undefined ? primaryTag(tags) : null

  const result = await query<IdeaRow>(
    `UPDATE ideas
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
      RETURNING ${IDEA_FIELDS}`,
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
  const idea = result.rows[0]
  return idea ? mapIdeaRow(idea) : null
}

export async function deleteIdea(id: string) {
  await query(`DELETE FROM ideas WHERE id = $1`, [id])
}

export async function reorderIdea(
  id: string,
  direction: "up" | "down",
): Promise<ReorderResult> {
  return withTransaction(async (client) => {
    const allRes = await client.query<{ id: string; sort_order: number }>(
      `SELECT id, sort_order FROM ideas
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
      `UPDATE ideas SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
      [current.id, target.sort_order],
    )
    await client.query(
      `UPDATE ideas SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
      [target.id, current.sort_order],
    )

    return "ok"
  })
}
