import {
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3"
import { query } from "@/lib/db"
import type { ProjectRecord } from "@/lib/domain-types"
import { getS3Bucket, projectObjectPrefix } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { TRASH_RETENTION_DAYS } from "@/lib/storage/trash"

const PROJECT_FIELDS = `
  id,
  user_id AS "ownerId",
  user_id AS "userId",
  COALESCE(storage_owner_id, user_id) AS "storageOwnerId",
  name,
  COALESCE(description, '') AS description,
  COALESCE(group_name, 'personal') AS "groupName",
  COALESCE(is_paused, FALSE) AS "isPaused",
  drive_folder_id AS "driveFolderId",
  NOT COALESCE(is_paused, FALSE) AS "isActive",
  COALESCE(is_archived, FALSE) AS "isArchived",
  archived_at AS "archivedAt",
  client_id AS "clientId",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  yougile_chat_id AS "yougileChatId",
  deleted_at AS "deletedAt"
`

export type ProjectRecordWithTrash = ProjectRecord & {
  deletedAt: Date | null
}

export async function softDeleteProject(
  id: string,
  ownerId: string,
): Promise<ProjectRecordWithTrash | null> {
  const result = await query<ProjectRecordWithTrash>(
    `UPDATE projects
        SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING ${PROJECT_FIELDS}`,
    [id, ownerId],
  )
  return result.rows[0] ?? null
}

export async function restoreDeletedProject(
  id: string,
  ownerId: string,
): Promise<ProjectRecordWithTrash | null> {
  const result = await query<ProjectRecordWithTrash>(
    `UPDATE projects
        SET deleted_at = NULL, updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
      RETURNING ${PROJECT_FIELDS}`,
    [id, ownerId],
  )
  return result.rows[0] ?? null
}

export async function listDeletedProjects(
  ownerId: string,
): Promise<ProjectRecordWithTrash[]> {
  const result = await query<ProjectRecordWithTrash>(
    `SELECT ${PROJECT_FIELDS}
       FROM projects
      WHERE user_id = $1 AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC`,
    [ownerId],
  )
  return result.rows
}

async function deleteProjectPrefix(
  storageOwnerId: string,
  projectId: string,
): Promise<number> {
  if (!isS3Configured()) return 0
  const client = getS3Client()
  const bucket = getS3Bucket()
  const prefix = projectObjectPrefix(storageOwnerId, projectId)
  let deleted = 0
  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (!obj.Key) continue
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }),
      )
      deleted++
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return deleted
}

/** Permanently remove projects soft-deleted longer than trash retention. */
export async function purgeDeletedProjects(): Promise<{ purged: number }> {
  const cutoff = new Date(
    Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )
  // Чистим по адресу в хранилище, а не по владельцу: у переданного проекта
  // объекты остались под тем, кто его завёл, и удаление по user_id прошло бы по
  // пустому префиксу, оставив байты в бакете навсегда.
  const rows = await query<{ id: string; storageOwnerId: string }>(
    `SELECT id, COALESCE(storage_owner_id, user_id) AS "storageOwnerId"
       FROM projects
      WHERE deleted_at IS NOT NULL AND deleted_at < $1
      LIMIT 50`,
    [cutoff],
  )
  let purged = 0
  for (const row of rows.rows) {
    try {
      await deleteProjectPrefix(row.storageOwnerId, row.id)
    } catch (error) {
      console.error("[storage] purge project R2 failed", row.id, error)
    }
    await query(`DELETE FROM projects WHERE id = $1`, [row.id])
    purged++
  }
  return { purged }
}
