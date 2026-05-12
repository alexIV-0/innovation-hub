import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import type { IdeaRecord } from "@/lib/domain-types"
import type { ReorderResult } from "@/lib/repositories/videos"

const IDEA_FIELDS = `
  id,
  title,
  description,
  category,
  is_published AS "isPublished",
  sort_order AS "sortOrder",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

export async function listIdeas(): Promise<IdeaRecord[]> {
  const result = await query<IdeaRecord>(
    `SELECT ${IDEA_FIELDS} FROM ideas ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows
}

export async function listPublishedIdeas(): Promise<IdeaRecord[]> {
  const result = await query<IdeaRecord>(
    `SELECT ${IDEA_FIELDS}
       FROM ideas
      WHERE is_published = true
      ORDER BY sort_order ASC, created_at ASC`,
  )
  return result.rows
}

export async function createIdea(input: {
  title: string
  description: string
  category: string
  isPublished: boolean
}): Promise<IdeaRecord> {
  const id = randomUUID()
  // Atomic: compute the next sort_order inline so concurrent inserts can't
  // collide on MAX() reads (see videos repo for the same pattern).
  const result = await query<IdeaRecord>(
    `INSERT INTO ideas (
        id, title, description, category, is_published, sort_order
     ) VALUES (
        $1, $2, $3, $4, $5,
        (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM ideas)
     )
     RETURNING ${IDEA_FIELDS}`,
    [
      id,
      input.title,
      input.description,
      input.category,
      input.isPublished,
    ],
  )
  return result.rows[0]
}

export async function updateIdea(
  id: string,
  input: Partial<{
    title: string
    description: string
    category: string
    isPublished: boolean
  }>,
): Promise<IdeaRecord | null> {
  const result = await query<IdeaRecord>(
    `UPDATE ideas
        SET title        = COALESCE($2, title),
            description  = COALESCE($3, description),
            category     = COALESCE($4, category),
            is_published = COALESCE($5, is_published),
            updated_at   = NOW()
      WHERE id = $1
      RETURNING ${IDEA_FIELDS}`,
    [
      id,
      input.title ?? null,
      input.description ?? null,
      input.category ?? null,
      input.isPublished ?? null,
    ],
  )
  return result.rows[0] ?? null
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
