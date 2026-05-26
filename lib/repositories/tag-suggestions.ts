import { query } from "@/lib/db"
import type { TagSuggestionRecord } from "@/lib/domain-types"
import { normalizeTag } from "@/lib/tags"

const FIELDS = `
  field_scope AS "fieldScope",
  value,
  usage_count AS "usageCount",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

export async function listTagSuggestions(input: {
  fieldScope: string
  q?: string
  limit?: number
}): Promise<TagSuggestionRecord[]> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 50)
  const q = input.q?.trim().toLowerCase() ?? ""

  if (q) {
    const result = await query<TagSuggestionRecord>(
      `SELECT ${FIELDS}
         FROM tag_suggestions
        WHERE field_scope = $1 AND lower(value) LIKE $2
        ORDER BY usage_count DESC, value ASC
        LIMIT $3`,
      [input.fieldScope, `${q}%`, limit],
    )
    return result.rows
  }

  const result = await query<TagSuggestionRecord>(
    `SELECT ${FIELDS}
       FROM tag_suggestions
      WHERE field_scope = $1
      ORDER BY usage_count DESC, value ASC
      LIMIT $2`,
    [input.fieldScope, limit],
  )
  return result.rows
}

export async function upsertTagSuggestion(input: {
  fieldScope: string
  value: string
}): Promise<TagSuggestionRecord> {
  const value = normalizeTag(input.value)
  if (!value) {
    throw new Error("EMPTY_TAG_VALUE")
  }

  const result = await query<TagSuggestionRecord>(
    `INSERT INTO tag_suggestions (field_scope, value, usage_count)
     VALUES ($1, $2, 1)
     ON CONFLICT (field_scope, value)
     DO UPDATE SET
       usage_count = tag_suggestions.usage_count + 1,
       updated_at = NOW()
     RETURNING ${FIELDS}`,
    [input.fieldScope, value],
  )
  return result.rows[0]
}

export async function deleteTagSuggestion(input: {
  fieldScope: string
  value: string
}): Promise<boolean> {
  const value = normalizeTag(input.value)
  const result = await query(
    `DELETE FROM tag_suggestions
      WHERE field_scope = $1 AND value = $2`,
    [input.fieldScope, value],
  )
  return (result.rowCount ?? 0) > 0
}
