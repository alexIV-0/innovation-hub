import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { ProjectMediaRecord, ProjectRecord } from "@/lib/domain-types"

const PROJECT_FIELDS = `
  id,
  user_id AS "userId",
  name,
  description,
  drive_folder_id AS "driveFolderId",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
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

export async function updateProject(
  id: string,
  userId: string,
  input: { name?: string; description?: string },
): Promise<ProjectRecord | null> {
  const result = await query<ProjectRecord>(
    `UPDATE projects
        SET name        = COALESCE($3, name),
            description = COALESCE($4, description),
            updated_at  = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING ${PROJECT_FIELDS}`,
    [id, userId, input.name ?? null, input.description ?? null],
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
