import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import type { PoolClient } from "pg"
import { withTransaction } from "@/lib/db"
import type { ProjectFileRecord } from "@/lib/domain-types"
import {
  appendStorageChange,
  nowUnixSec,
} from "@/lib/storage/changes"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  assertLogicalPath,
  assertNameFree,
  folderPrefix,
  isMoveIntoSelf,
  validateLogicalName,
} from "@/lib/storage/file-names"
import {
  folderPathFromKey,
  isCatalogKey,
  isOptionsKey,
  logicalKeyForFile,
  logicalNameFromObjectKey,
  parseProjectIdFromKey,
  projectPrefix,
} from "@/lib/storage/keys"
import type { StorageChangeOp, StorageChangePayload } from "@/lib/storage/types"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

const FILE_FIELDS = `
  id,
  project_id AS "projectId",
  folder_path AS "folderPath",
  name,
  is_folder AS "isFolder",
  s3_key AS "s3Key",
  size_bytes::float8 AS "sizeBytes",
  content_type AS "contentType",
  created_at AS "createdAt"
`

export { StorageWriteError }

export type ObjectHead = {
  etag: string | null
  size: number
  contentHash: string | null
  originMtime: number | null
}

export async function headObject(key: string): Promise<ObjectHead | null> {
  if (!isS3Configured()) return null
  try {
    const response = await getS3Client().send(
      new HeadObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const meta = response.Metadata ?? {}
    const originRaw = meta["mtime"] ?? meta["x-amz-meta-mtime"]
    return {
      etag: response.ETag?.replace(/"/g, "") ?? null,
      size: Number(response.ContentLength ?? 0),
      contentHash: meta["sha256"] ?? meta["x-amz-meta-sha256"] ?? null,
      originMtime: originRaw ? Number.parseInt(String(originRaw), 10) : null,
    }
  } catch {
    return null
  }
}

async function journal(
  client: PoolClient,
  input: {
    projectId: string
    key: string
    op: StorageChangeOp
    size?: number | null
    etag?: string | null
    contentHash?: string | null
    eventId?: string | null
    payload?: StorageChangePayload
  },
): Promise<number> {
  return appendStorageChange(client, {
    ...input,
    eventTime: nowUnixSec(),
  })
}

async function touchFileRow(
  client: PoolClient,
  fileId: string,
  seq: number,
  patch: {
    etag?: string | null
    contentHash?: string | null
    originMtime?: number | null
    sizeBytes?: number
    s3Key?: string
  },
): Promise<void> {
  await client.query(
    `UPDATE project_files
        SET etag = COALESCE($3, etag),
            content_hash = COALESCE($4, content_hash),
            origin_mtime = COALESCE($5, origin_mtime),
            size_bytes = COALESCE($6, size_bytes),
            s3_key = COALESCE($7, s3_key),
            updated_at = NOW(),
            last_seq = $2,
            deleted_at = NULL
      WHERE id = $1`,
    [
      fileId,
      seq,
      patch.etag ?? null,
      patch.contentHash ?? null,
      patch.originMtime ?? null,
      patch.sizeBytes ?? null,
      patch.s3Key ?? null,
    ],
  )
}

export async function writeFolderCreate(input: {
  userId: string
  projectId: string
  folderPath: string
  name: string
  eventId?: string
}): Promise<ProjectFileRecord> {
  const name = validateLogicalName(input.name)
  const folderPath = input.folderPath.replace(/^\/+|\/+$/g, "")
  assertLogicalPath(folderPath, name)

  return withTransaction(async (client) => {
    await assertNameFree(client, {
      projectId: input.projectId,
      folderPath,
      name,
    })
    const id = randomUUID()
    const key = logicalKeyForFile({
      userId: input.userId,
      projectId: input.projectId,
      folderPath,
      name,
    })

    const result = await client.query<ProjectFileRecord>(
      `INSERT INTO project_files (
          id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
       )
       VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '')
       RETURNING ${FILE_FIELDS}`,
      [id, input.projectId, folderPath, name],
    )
    const file = result.rows[0]!

    const seq = await journal(client, {
      projectId: input.projectId,
      key,
      op: "put",
      size: 0,
      eventId: input.eventId ?? null,
      payload: {
        fileId: file.id,
        name,
        folderPath,
        isFolder: true,
      },
    })
    await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
      file.id,
      seq,
    ])
    return file
  })
}

/**
 * Ensure every segment of `folderPath` exists (a/b/c). Returns the deepest folder row.
 * Creates missing parents; returns the last existing/created folder, or null for root.
 */
export async function writeEnsureFolderPath(input: {
  userId: string
  projectId: string
  folderPath: string
  eventId?: string
}): Promise<{ folderIds: string[]; folderPath: string }> {
  const cleaned = input.folderPath.replace(/^\/+|\/+$/g, "")
  if (!cleaned) return { folderIds: [], folderPath: "" }

  const segments = cleaned.split("/").filter(Boolean)
  const folderIds: string[] = []
  let parent = ""

  for (let i = 0; i < segments.length; i++) {
    const name = validateLogicalName(segments[i]!)
    const existing = await withTransaction(async (client) => {
      const found = await client.query<ProjectFileRecord>(
        `SELECT ${FILE_FIELDS}
           FROM project_files
          WHERE project_id = $1
            AND lower(folder_path) = lower($2)
            AND lower(name) = lower($3)
            AND is_folder = TRUE
            AND deleted_at IS NULL
          LIMIT 1`,
        [input.projectId, parent, name],
      )
      return found.rows[0] ?? null
    })

    if (existing) {
      folderIds.push(existing.id)
      parent = parent ? `${parent}/${existing.name}` : existing.name
      continue
    }

    const created = await writeFolderCreate({
      userId: input.userId,
      projectId: input.projectId,
      folderPath: parent,
      name,
      eventId: input.eventId
        ? `${input.eventId}:mkdir:${i}`
        : undefined,
    })
    folderIds.push(created.id)
    parent = parent ? `${parent}/${created.name}` : created.name
  }

  return { folderIds, folderPath: parent }
}

export async function writeFilePut(input: {
  projectId: string
  folderPath: string
  name: string
  s3Key: string
  sizeBytes: number
  contentType: string
  etag?: string | null
  contentHash?: string | null
  originMtime?: number | null
  eventId?: string
}): Promise<ProjectFileRecord> {
  const name = validateLogicalName(input.name)
  const folderPath = input.folderPath.replace(/^\/+|\/+$/g, "")
  assertLogicalPath(folderPath, name)

  return withTransaction(async (client) => {
    await assertNameFree(client, {
      projectId: input.projectId,
      folderPath,
      name,
    })
    const id = randomUUID()
    const result = await client.query<ProjectFileRecord>(
      `INSERT INTO project_files (
          id, project_id, folder_path, name, is_folder, s3_key,
          size_bytes, content_type, etag, content_hash, origin_mtime
       )
       VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7, $8, $9, $10)
       RETURNING ${FILE_FIELDS}`,
      [
        id,
        input.projectId,
        folderPath,
        name,
        input.s3Key,
        input.sizeBytes,
        input.contentType,
        input.etag ?? null,
        input.contentHash ?? null,
        input.originMtime ?? null,
      ],
    )
    const file = result.rows[0]!

    const seq = await journal(client, {
      projectId: input.projectId,
      key: input.s3Key,
      op: "put",
      size: input.sizeBytes,
      etag: input.etag ?? null,
      contentHash: input.contentHash ?? null,
      eventId: input.eventId ?? null,
      payload: {
        fileId: file.id,
        name,
        folderPath,
        isFolder: false,
        contentType: input.contentType,
      },
    })
    await touchFileRow(client, file.id, seq, {
      etag: input.etag,
      contentHash: input.contentHash,
      originMtime: input.originMtime,
    })
    return file
  })
}

export async function writeNotifyUpload(input: {
  projectId: string
  s3Key: string
  folderPath: string
  fileName: string
  sizeBytes?: number
  contentType?: string
  /** Unix seconds; preferred over R2 object metadata when provided. */
  originMtime?: number | null
  /** Content hash (e.g. sha256 hex); preferred over R2 metadata when provided. */
  contentHash?: string | null
  eventId?: string
}): Promise<ProjectFileRecord> {
  const head = await headObject(input.s3Key)
  if (!head) {
    throw new StorageWriteError("Object not found in storage.")
  }

  const contentHash =
    input.contentHash !== undefined && input.contentHash !== null
      ? input.contentHash
      : head.contentHash
  const originMtime =
    input.originMtime !== undefined && input.originMtime !== null
      ? input.originMtime
      : head.originMtime

  const existing = await withTransaction(async (client) => {
    const found = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS} FROM project_files WHERE s3_key = $1`,
      [input.s3Key],
    )
    return found.rows[0] ?? null
  })

  if (existing) {
    return withTransaction(async (client) => {
      const seq = await journal(client, {
        projectId: input.projectId,
        key: input.s3Key,
        op: "put",
        size: head.size,
        etag: head.etag,
        contentHash,
        eventId: input.eventId ?? null,
        payload: {
          fileId: existing.id,
          name: existing.name,
          folderPath: existing.folderPath,
          isFolder: false,
        },
      })
      await touchFileRow(client, existing.id, seq, {
        etag: head.etag,
        contentHash,
        originMtime,
        sizeBytes: head.size,
      })
      const updated = await client.query<ProjectFileRecord>(
        `SELECT ${FILE_FIELDS} FROM project_files WHERE id = $1`,
        [existing.id],
      )
      return updated.rows[0]!
    })
  }

  return writeFilePut({
    projectId: input.projectId,
    folderPath: input.folderPath,
    name: input.fileName,
    s3Key: input.s3Key,
    sizeBytes: input.sizeBytes ?? head.size,
    contentType: input.contentType ?? "application/octet-stream",
    etag: head.etag,
    contentHash,
    originMtime,
    eventId: input.eventId,
  })
}

export async function writeFileDelete(input: {
  userId: string
  projectId: string
  fileId: string
  deletedBy?: string | null
  eventId?: string
}): Promise<{ fileIds: string[]; deletedS3Keys: string[] }> {
  return withTransaction(async (client) => {
    const found = await client.query<{
      id: string
      projectId: string
      folderPath: string
      name: string
      isFolder: boolean
      s3Key: string | null
    }>(
      `SELECT id,
              project_id AS "projectId",
              folder_path AS "folderPath",
              name,
              is_folder AS "isFolder",
              s3_key AS "s3Key"
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) return { fileIds: [], deletedS3Keys: [] }

    const prefix = existing.isFolder
      ? folderPrefix(existing.folderPath, existing.name)
      : null

    const targets = await client.query<{
      id: string
      s3Key: string | null
      name: string
      folderPath: string
      isFolder: boolean
    }>(
      prefix == null
        ? `SELECT id, s3_key AS "s3Key", name, folder_path AS "folderPath",
                  is_folder AS "isFolder"
             FROM project_files
            WHERE id = $1 AND deleted_at IS NULL`
        : `SELECT id, s3_key AS "s3Key", name, folder_path AS "folderPath",
                  is_folder AS "isFolder"
             FROM project_files
            WHERE project_id = $2
              AND deleted_at IS NULL
              AND (id = $1 OR folder_path = $3 OR folder_path LIKE $3 || '/%')`,
      prefix == null
        ? [existing.id]
        : [existing.id, input.projectId, prefix],
    )

    const deletedAt = new Date()
    const fileIds: string[] = []

    for (const row of targets.rows) {
      const key =
        row.s3Key ??
        logicalKeyForFile({
          userId: input.userId,
          projectId: input.projectId,
          folderPath: row.folderPath,
          name: row.name,
        })
      const seq = await journal(client, {
        projectId: input.projectId,
        key,
        op: "delete",
        eventId: input.eventId
          ? row.id === existing.id
            ? input.eventId
            : `${input.eventId}:${row.id}`
          : null,
        payload: {
          fileId: row.id,
          name: row.name,
          folderPath: row.folderPath,
          isFolder: row.isFolder,
        },
      })
      await client.query(
        `UPDATE project_files
            SET deleted_at = $3, deleted_by = $4, last_seq = $2, updated_at = NOW()
          WHERE id = $1`,
        [row.id, seq, deletedAt, input.deletedBy ?? null],
      )
      fileIds.push(row.id)
    }

    return { fileIds, deletedS3Keys: [] }
  })
}

export async function writeRename(input: {
  userId: string
  projectId: string
  fileId: string
  name?: string
  folderPath?: string
  eventId?: string
}): Promise<ProjectFileRecord | null> {
  return withTransaction(async (client) => {
    const found = await client.query<ProjectFileRecord>(
      `SELECT ${FILE_FIELDS}
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) return null

    const newName = input.name !== undefined
      ? validateLogicalName(input.name)
      : existing.name
    const newFolder = (input.folderPath ?? existing.folderPath).replace(
      /^\/+|\/+$/g,
      "",
    )
    assertLogicalPath(newFolder, newName)

    if (newName === existing.name && newFolder === existing.folderPath) {
      return existing
    }

    if (existing.isFolder) {
      const oldPrefix = folderPrefix(existing.folderPath, existing.name)
      if (isMoveIntoSelf(oldPrefix, newFolder)) {
        throw new StorageWriteError(
          "Cannot move a folder into itself or a descendant.",
          409,
        )
      }
    }

    await assertNameFree(client, {
      projectId: input.projectId,
      folderPath: newFolder,
      name: newName,
      excludeId: existing.id,
    })

    if (existing.isFolder) {
      const oldPrefix = folderPrefix(existing.folderPath, existing.name)
      const newPrefix = folderPrefix(newFolder, newName)

      await client.query(
        `UPDATE project_files
            SET folder_path = CASE
                  WHEN folder_path = $2 THEN $3
                  ELSE $3 || substr(folder_path, length($2) + 1)
                END,
                updated_at = NOW()
          WHERE project_id = $1
            AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
        [input.projectId, oldPrefix, newPrefix],
      )
    }

    const result = await client.query<ProjectFileRecord>(
      `UPDATE project_files
          SET name = $3,
              folder_path = $4,
              updated_at = NOW()
        WHERE id = $1 AND project_id = $2
        RETURNING ${FILE_FIELDS}`,
      [input.fileId, input.projectId, newName, newFolder],
    )
    const file = result.rows[0]
    if (!file) return null

    const key =
      existing.s3Key ??
      logicalKeyForFile({
        userId: input.userId,
        projectId: input.projectId,
        folderPath: existing.folderPath,
        name: existing.name,
      })

    const seq = await journal(client, {
      projectId: input.projectId,
      key,
      op: "move",
      size: file.isFolder ? 0 : file.sizeBytes,
      eventId: input.eventId ?? null,
      payload: {
        fileId: file.id,
        isFolder: existing.isFolder,
        name: file.name,
        folderPath: file.folderPath,
        from: { folderPath: existing.folderPath, name: existing.name },
        to: { folderPath: file.folderPath, name: file.name },
      },
    })
    await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
      file.id,
      seq,
    ])

    return file
  })
}

export async function writeSidecarPut(input: {
  projectId: string
  key: string
  body: string
  contentType?: string
  ifMatch?: string | null
  eventId?: string
}): Promise<{ etag: string | null }> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.")
  }

  const command = new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType ?? "application/json",
    ...(input.ifMatch ? { IfMatch: input.ifMatch } : {}),
  })

  let response
  try {
    response = await getS3Client().send(command)
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "$metadata" in error &&
      typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === "number"
        ? (error as { $metadata: { httpStatusCode: number } }).$metadata
            .httpStatusCode
        : null
    if (status === 412) {
      throw new StorageWriteError("Precondition failed (ETag mismatch).")
    }
    throw error
  }

  const etag = response.ETag?.replace(/"/g, "") ?? null
  await withTransaction(async (client) => {
    await journal(client, {
      projectId: input.projectId,
      key: input.key,
      op: "put",
      size: Buffer.byteLength(input.body, "utf8"),
      etag,
      eventId: input.eventId ?? null,
      payload: { name: input.key.split("/").pop() },
    })
  })
  return { etag }
}

export async function writeR2PutFromBuffer(input: {
  projectId: string
  key: string
  body: Buffer
  contentType: string
  fileName: string
  folderPath: string
  eventId?: string
}): Promise<ProjectFileRecord> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.")
  }

  const response = await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  )

  const etag = response.ETag?.replace(/"/g, "") ?? null
  return writeFilePut({
    projectId: input.projectId,
    folderPath: input.folderPath,
    name: input.fileName,
    s3Key: input.key,
    sizeBytes: input.body.length,
    contentType: input.contentType,
    etag,
    eventId: input.eventId,
  })
}

export async function reindexProject(userId: string, projectId: string): Promise<{
  scanned: number
  inserted: number
  updated: number
  removed: number
}> {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.")
  }

  const prefix = projectPrefix(userId, projectId)
  const client = getS3Client()
  const bucket = getS3Bucket()
  const remoteKeys = new Map<string, ObjectHead>()

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
      if (!obj.Key || obj.Key.endsWith("/")) continue
      if (obj.Key.includes("/options/")) continue
      if (obj.Key.includes("/_catalog/")) continue
      if (obj.Key.endsWith("project-meta.json")) continue
      remoteKeys.set(obj.Key, {
        etag: obj.ETag?.replace(/"/g, "") ?? null,
        size: Number(obj.Size ?? 0),
        contentHash: null,
        originMtime: obj.LastModified
          ? Math.floor(obj.LastModified.getTime() / 1000)
          : null,
      })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  let inserted = 0
  let updated = 0
  let removed = 0

  await withTransaction(async (db) => {
    const local = await db.query<{
      id: string
      s3Key: string
      etag: string | null
      name: string
    }>(
      `SELECT id, s3_key AS "s3Key", etag, name
         FROM project_files
        WHERE project_id = $1 AND s3_key IS NOT NULL AND is_folder = FALSE`,
      [projectId],
    )
    const localByKey = new Map(local.rows.map((r) => [r.s3Key, r]))

    for (const [key, head] of remoteKeys) {
      const physicalName = key.slice(key.lastIndexOf("/") + 1)
      const name = logicalNameFromObjectKey(physicalName)
      const folderPath = folderPathFromKey(
        userId,
        projectId,
        key,
        physicalName,
      )
      const row = localByKey.get(key)
      if (!row) {
        const fileId = randomUUID()
        await db.query(
          `INSERT INTO project_files (
              id, project_id, folder_path, name, is_folder, s3_key,
              size_bytes, content_type, etag, origin_mtime
           )
           VALUES ($1, $2, $3, $4, FALSE, $5, $6, '', $7, $8)`,
          [
            fileId,
            projectId,
            folderPath,
            name,
            key,
            head.size,
            head.etag,
            head.originMtime,
          ],
        )
        await journal(db, {
          projectId,
          key,
          op: "put",
          size: head.size,
          etag: head.etag,
          eventId: `reindex:put:${createHash("sha256").update(key).digest("hex").slice(0, 16)}`,
          payload: { fileId, name, folderPath, isFolder: false },
        })
        inserted++
      } else if (row.etag !== head.etag) {
        const seq = await journal(db, {
          projectId,
          key,
          op: "put",
          size: head.size,
          etag: head.etag,
          eventId: `reindex:sync:${createHash("sha256").update(key + (head.etag ?? "")).digest("hex").slice(0, 16)}`,
          payload: {
            fileId: row.id,
            name: row.name,
            folderPath,
            isFolder: false,
          },
        })
        await db.query(
          `UPDATE project_files
              SET etag = $3, size_bytes = $4, origin_mtime = $5, last_seq = $2, updated_at = NOW()
            WHERE id = $1`,
          [row.id, seq, head.etag, head.size, head.originMtime],
        )
        updated++
      }
      localByKey.delete(key)
    }

    for (const [, row] of localByKey) {
      // options/* is listed out of remoteKeys (sidecars + processing stats).
      // Do not treat those catalog rows as missing objects.
      if (isOptionsKey(row.s3Key, userId, projectId)) continue
      if (isCatalogKey(row.s3Key, userId, projectId)) continue
      await journal(db, {
        projectId,
        key: row.s3Key,
        op: "delete",
        eventId: `reindex:del:${row.id}`,
        payload: { fileId: row.id },
      })
      await db.query(`DELETE FROM project_files WHERE id = $1`, [row.id])
      removed++
    }
  })

  return { scanned: remoteKeys.size, inserted, updated, removed }
}

/** Append a journal row after an external R2 write (e.g. sidecar helpers). */
export async function journalStorageEvent(input: {
  projectId: string
  key: string
  op: StorageChangeOp
  size?: number | null
  etag?: string | null
  contentHash?: string | null
  eventId?: string | null
  payload?: StorageChangePayload
}): Promise<number> {
  return withTransaction(async (client) => journal(client, input))
}

export function hashMachineToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function generateMachineToken(): string {
  return `mch_${randomBytes(32).toString("base64url")}`
}

export { parseProjectIdFromKey, projectPrefix }
