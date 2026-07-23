import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { ProjectMediaRecord, ProjectRecord } from "@/lib/domain-types"

const PROJECT_FIELDS = `
  id,
  user_id AS "userId",
  name,
  description,
  drive_folder_id AS "driveFolderId",
  is_active AS "isActive",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  yougile_chat_id AS "yougileChatId"
`

const MEDIA_FIELDS = `
  id,
  project_id AS "projectId",
  file_name AS "fileName",
  mime_type AS "mimeType",
  size_bytes AS "sizeBytes",
  drive_file_id AS "driveFileId",
  created_at AS "createdAt"
`

export async function listProjectsByUserId(
  userId: string,
): Promise<ProjectRecord[]> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
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

export async function findProjectForUser(
  id: string,
  userId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE id = $1 AND user_id = $2`,
    [id, userId],
  )
  return result.rows[0] ?? null
}

/**
 * Looks a project up by its Drive folder id rather than our own primary key.
 * Used when reconciling the DB cache against a live scan of the user's Drive
 * folder — Drive folder id is the stable identity there, our own id is not.
 */
export async function findProjectByDriveFolderId(
  driveFolderId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS} FROM projects WHERE drive_folder_id = $1`,
    [driveFolderId],
  )
  return result.rows[0] ?? null
}

export async function createProject(input: {
  userId: string
  name: string
  description: string
  driveFolderId?: string | null
}): Promise<ProjectRecord> {
  const id = randomUUID()
  const result = await query<ProjectRecord>(
    `INSERT INTO projects (id, user_id, name, description, drive_folder_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${PROJECT_FIELDS}`,
    [
      id,
      input.userId,
      input.name,
      input.description,
      input.driveFolderId ?? null,
    ],
  )
  return result.rows[0]
}

export async function setProjectDriveFolderId(
  id: string,
  driveFolderId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET drive_folder_id = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PROJECT_FIELDS}`,
    [id, driveFolderId],
  )
  return result.rows[0] ?? null
}

/**
 * Looks a project up by its YouGile group chat id — used by the webhook
 * receiver to route an incoming `chat_message-created` event without
 * requiring the caller to be authenticated as the owning user.
 */
export async function findProjectByYougileChatId(
  yougileChatId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `SELECT ${PROJECT_FIELDS} FROM projects WHERE yougile_chat_id = $1`,
    [yougileChatId],
  )
  return result.rows[0] ?? null
}

/** Persists the YouGile group chat id once it has been lazily created. */
export async function setProjectYougileChatId(
  id: string,
  yougileChatId: string,
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET yougile_chat_id = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PROJECT_FIELDS}`,
    [id, yougileChatId],
  )
  return result.rows[0] ?? null
}

export async function updateProject(
  id: string,
  userId: string,
  input: { name?: string; description?: string; isActive?: boolean },
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET name        = COALESCE($3, name),
            description = COALESCE($4, description),
            is_active   = COALESCE($5, is_active),
            updated_at  = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING ${PROJECT_FIELDS}`,
    [
      id,
      userId,
      input.name ?? null,
      input.description ?? null,
      input.isActive ?? null,
    ],
  )
  return result.rows[0] ?? null
}

export async function deleteProject(id: string, userId: string) {
  await query(`DELETE FROM projects WHERE id = $1 AND user_id = $2`, [
    id,
    userId,
  ])
}

export async function listProjectMedia(
  projectId: string,
): Promise<ProjectMediaRecord[]> {
  const result = await query<ProjectMediaRecord & { sizeBytes: number | string | null }>(
    `SELECT ${MEDIA_FIELDS}
       FROM project_media
      WHERE project_id = $1
      ORDER BY created_at DESC`,
    [projectId],
  )
  return result.rows.map(normalizeMedia)
}

export async function findProjectMedia(
  id: string,
  projectId: string,
): Promise<ProjectMediaRecord | null> {
  const result = await query<ProjectMediaRecord & { sizeBytes: number | string | null }>(
    `SELECT ${MEDIA_FIELDS}
       FROM project_media
      WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  )
  const row = result.rows[0]
  return row ? normalizeMedia(row) : null
}

function normalizeMedia(
  row: ProjectMediaRecord & { sizeBytes: number | string | null },
): ProjectMediaRecord {
  const raw = row.sizeBytes
  const sizeBytes =
    raw == null
      ? null
      : typeof raw === "number"
        ? raw
        : Number.parseInt(String(raw), 10)
  return {
    ...row,
    sizeBytes: Number.isFinite(sizeBytes as number) ? (sizeBytes as number) : null,
  }
}

export async function createProjectMedia(input: {
  projectId: string
  fileName: string
  mimeType: string
  sizeBytes?: number | null
  driveFileId: string
}): Promise<ProjectMediaRecord> {
  const id = randomUUID()
  const result = await query<ProjectMediaRecord & { sizeBytes: number | string | null }>(
    `INSERT INTO project_media (
        id, project_id, file_name, mime_type, size_bytes, drive_file_id
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MEDIA_FIELDS}`,
    [
      id,
      input.projectId,
      input.fileName,
      input.mimeType,
      input.sizeBytes ?? null,
      input.driveFileId,
    ],
  )
  return normalizeMedia(result.rows[0])
}

export async function deleteProjectMedia(id: string, projectId: string) {
  await query(
    `DELETE FROM project_media WHERE id = $1 AND project_id = $2`,
    [id, projectId],
  )
}

export async function deleteProjectMediaByDriveFileId(
  driveFileId: string,
  projectId: string,
) {
  await query(
    `DELETE FROM project_media WHERE drive_file_id = $1 AND project_id = $2`,
    [driveFileId, projectId],
  )
}

export async function countProjectsByUserId(userId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM projects WHERE user_id = $1`,
    [userId],
  )
  return result.rows[0]?.count ?? 0
}

export async function countMediaByUserId(userId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM project_media m
       JOIN projects p ON p.id = m.project_id
      WHERE p.user_id = $1`,
    [userId],
  )
  return result.rows[0]?.count ?? 0
}
