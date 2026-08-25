import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { UpdateToolInput } from "@/lib/tool-schemas"

const FIELDS = `
  id,
  user_id AS "userId",
  tool_key AS "toolKey",
  COALESCE(title, '') AS title,
  settings,
  source,
  sort_order AS "sortOrder",
  last_opened_at AS "lastOpenedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

export type UserToolRecord = {
  id: string
  userId: string
  toolKey: string
  title: string
  settings: Record<string, unknown>
  source: Record<string, unknown>
  sortOrder: number
  lastOpenedAt: string | null
  createdAt: string
  updatedAt: string
}

export async function listUserTools(userId: string): Promise<UserToolRecord[]> {
  const { rows } = await query<UserToolRecord>(
    `SELECT ${FIELDS} FROM user_tools
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY sort_order, created_at`,
    [userId],
  )
  return rows
}

export async function findUserTool(
  id: string,
  userId: string,
): Promise<UserToolRecord | null> {
  const { rows } = await query<UserToolRecord>(
    `SELECT ${FIELDS} FROM user_tools
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId],
  )
  return rows[0] ?? null
}

export async function createUserTool(input: {
  userId: string
  toolKey: string
  defaults: Record<string, unknown>
}): Promise<UserToolRecord> {
  const { rows } = await query<UserToolRecord>(
    `INSERT INTO user_tools (id, user_id, tool_key, settings, sort_order)
     VALUES (
       $1, $2, $3, $4::jsonb,
       COALESCE((SELECT MAX(sort_order) + 1 FROM user_tools WHERE user_id = $2), 0)
     )
     RETURNING ${FIELDS}`,
    [randomUUID(), input.userId, input.toolKey, JSON.stringify(input.defaults)],
  )
  return rows[0]!
}

/**
 * Правка экземпляра. `settings` и `source` сливаются с сохранёнными, а не
 * заменяют их целиком: страница присылает только то, что поменяла, и не должна
 * знать про остальные ключи.
 */
export async function updateUserTool(
  id: string,
  userId: string,
  patch: UpdateToolInput,
): Promise<UserToolRecord | null> {
  const { rows } = await query<UserToolRecord>(
    `UPDATE user_tools SET
       title = COALESCE($3, title),
       settings = CASE WHEN $4::jsonb IS NULL THEN settings ELSE settings || $4::jsonb END,
       source = CASE WHEN $5::jsonb IS NULL THEN source ELSE source || $5::jsonb END,
       sort_order = COALESCE($6, sort_order),
       last_opened_at = CASE WHEN $7 THEN NOW() ELSE last_opened_at END,
       updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING ${FIELDS}`,
    [
      id,
      userId,
      patch.title ?? null,
      patch.settings ? JSON.stringify(patch.settings) : null,
      patch.source ? JSON.stringify(patch.source) : null,
      patch.sortOrder ?? null,
      patch.touch === true,
    ],
  )
  return rows[0] ?? null
}

export async function deleteUserTool(id: string, userId: string): Promise<boolean> {
  const { rowCount } = await query(
    `UPDATE user_tools SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [id, userId],
  )
  return (rowCount ?? 0) > 0
}
