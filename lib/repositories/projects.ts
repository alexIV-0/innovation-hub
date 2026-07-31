import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { ProjectGroupName, ProjectRecord } from "@/lib/domain-types"

const PROJECT_FIELDS = `
  id,
  user_id AS "ownerId",
  name,
  COALESCE(description, '') AS description,
  COALESCE(group_name, 'personal') AS "groupName",
  COALESCE(is_paused, FALSE) AS "isPaused",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`

export type ProjectWithUnread = ProjectRecord & {
  unreadCount: number
}

export async function listProjectsByOwner(
  ownerId: string,
): Promise<ProjectWithUnread[]> {
  const result = await query<ProjectWithUnread>(
    `SELECT ${PROJECT_FIELDS},
            COALESCE((
              SELECT COUNT(*)::int
                FROM project_messages m
               WHERE m.project_id = projects.id
                 AND m.sender_role = 'team'
                 AND m.read_by_user = FALSE
            ), 0) AS "unreadCount"
       FROM projects
      WHERE user_id = $1
      ORDER BY
        CASE COALESCE(group_name, 'personal')
          WHEN 'shared' THEN 0
          WHEN 'personal' THEN 1
          WHEN 'tools' THEN 2
          WHEN 'archive' THEN 3
          ELSE 4
        END,
        created_at DESC`,
    [ownerId],
  )
  return result.rows
}

export async function findProjectById(
  id: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS} FROM projects WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findOwnedProject(
  id: string,
  ownerId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE id = $1 AND user_id = $2`,
    [id, ownerId],
  )
  return result.rows[0] ?? null
}

export async function createProject(input: {
  ownerId: string
  name: string
  description?: string
  groupName?: ProjectGroupName
}): Promise<ProjectRecord> {
  const id = randomUUID()
  const result = await query<ProjectRecord>(
    `INSERT INTO projects (id, user_id, name, description, group_name, is_paused, is_active)
     VALUES ($1, $2, $3, COALESCE($4, ''), COALESCE($5, 'personal'), FALSE, TRUE)
     RETURNING ${PROJECT_FIELDS}`,
    [
      id,
      input.ownerId,
      input.name,
      input.description ?? "",
      input.groupName ?? "personal",
    ],
  )
  const project = result.rows[0]

  await query(
    `INSERT INTO project_files (id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type)
     VALUES
       ($1, $3, '', 'IN',  TRUE, NULL, 0, ''),
       ($2, $3, '', 'OUT', TRUE, NULL, 0, '')
     ON CONFLICT (project_id, folder_path, name) DO NOTHING`,
    [randomUUID(), randomUUID(), id],
  )

  return project
}

export async function updateProject(
  id: string,
  ownerId: string,
  input: {
    name?: string
    description?: string
    groupName?: ProjectGroupName
    isPaused?: boolean
  },
): Promise<ProjectRecord | null> {
  const isActive =
    input.isPaused === undefined ? null : !input.isPaused

  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET name        = COALESCE($3, name),
            description = COALESCE($4, description),
            group_name  = COALESCE($5, group_name),
            is_paused   = COALESCE($6, is_paused),
            is_active   = COALESCE($7, is_active),
            updated_at  = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING ${PROJECT_FIELDS}`,
    [
      id,
      ownerId,
      input.name ?? null,
      input.description ?? null,
      input.groupName ?? null,
      input.isPaused ?? null,
      isActive,
    ],
  )
  return result.rows[0] ?? null
}

export async function deleteProject(
  id: string,
  ownerId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM projects WHERE id = $1 AND user_id = $2`,
    [id, ownerId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function countProjectsByOwner(ownerId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1`,
    [ownerId],
  )
  return result.rows[0]?.count ?? 0
}
