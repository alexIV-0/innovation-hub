import { createHash, randomBytes, randomUUID } from "node:crypto"
import {
  DeleteObjectCommand,
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
import {
  folderPathFromKey,
  logicalKeyForFile,
  parseProjectIdFromKey,
  projectPrefix,
} from "@/lib/storage/keys"
import type { StorageChangePayload } from "@/lib/storage/types"
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

export class StorageWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StorageWriteError"
  }
}

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
    op: "put" | "delete"
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
  return withTransaction(async (client) => {
    const id = randomUUID()
    const key = logicalKeyForFile({
      userId: input.userId,
      projectId: input.projectId,
      folderPath: input.folderPath,
      name: input.name,
    })

    const result = await client.query<ProjectFileRecord>(
      `INSERT INTO project_files (
          id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
       )
       VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '')
       RETURNING ${FILE_FIELDS}`,
      [id, input.projectId, input.folderPath, input.name],
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
        name: input.name,
        folderPath: input.folderPath,
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
  return withTransaction(async (client) => {
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
        input.folderPath,
        input.name,
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
        name: input.name,
        folderPath: input.folderPath,
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
  deleteFromR2?: boolean
  eventId?: string
}): Promise<{ deletedS3Keys: string[] }> {
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
        WHERE id = $1 AND project_id = $2`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) return { deletedS3Keys: [] }

    const keys: string[] = []

    if (existing.isFolder) {
      const prefix =
        existing.folderPath === ""
          ? existing.name
          : `${existing.folderPath}/${existing.name}`

      const children = await client.query<{ s3Key: string | null; id: string; name: string; folderPath: string }>(
        `SELECT id, s3_key AS "s3Key", name, folder_path AS "folderPath"
           FROM project_files
          WHERE project_id = $1
            AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
        [input.projectId, prefix],
      )

      for (const child of children.rows) {
        if (child.s3Key) {
          keys.push(child.s3Key)
          const seq = await journal(client, {
            projectId: input.projectId,
            key: child.s3Key,
            op: "delete",
            eventId: input.eventId ? `${input.eventId}:${child.id}` : null,
            payload: {
              fileId: child.id,
              name: child.name,
              folderPath: child.folderPath,
              isFolder: false,
            },
          })
          await client.query(
            `UPDATE project_files SET deleted_at = NOW(), last_seq = $2 WHERE id = $1`,
            [child.id, seq],
          )
        }
      }

      await client.query(
        `DELETE FROM project_files
          WHERE project_id = $1
            AND (folder_path = $2 OR folder_path LIKE $2 || '/%')`,
        [input.projectId, prefix],
      )

      const folderKey = logicalKeyForFile({
        userId: input.userId,
        projectId: input.projectId,
        folderPath: existing.folderPath,
        name: existing.name,
      })
      await journal(client, {
        projectId: input.projectId,
        key: folderKey,
        op: "delete",
        eventId: input.eventId ? `${input.eventId}:folder` : null,
        payload: {
          fileId: existing.id,
          name: existing.name,
          folderPath: existing.folderPath,
          isFolder: true,
        },
      })
    } else if (existing.s3Key) {
      keys.push(existing.s3Key)
      const seq = await journal(client, {
        projectId: input.projectId,
        key: existing.s3Key,
        op: "delete",
        eventId: input.eventId ?? null,
        payload: {
          fileId: existing.id,
          name: existing.name,
          folderPath: existing.folderPath,
          isFolder: false,
        },
      })
      await client.query(
        `UPDATE project_files SET deleted_at = NOW(), last_seq = $2 WHERE id = $1`,
        [existing.id, seq],
      )
    }

    await client.query(
      `DELETE FROM project_files WHERE id = $1 AND project_id = $2`,
      [input.fileId, input.projectId],
    )

    if (input.deleteFromR2 !== false && keys.length > 0 && isS3Configured()) {
      const clientS3 = getS3Client()
      const bucket = getS3Bucket()
      await Promise.allSettled(
        keys.map((key) =>
          clientS3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
        ),
      )
    }

    return { deletedS3Keys: keys }
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
      `SELECT ${FILE_FIELDS} FROM project_files WHERE id = $1 AND project_id = $2`,
      [input.fileId, input.projectId],
    )
    const existing = found.rows[0]
    if (!existing) return null

    const newName = input.name ?? existing.name
    const newFolder = input.folderPath ?? existing.folderPath

    if (existing.isFolder) {
      const oldPrefix =
        existing.folderPath === ""
          ? existing.name
          : `${existing.folderPath}/${existing.name}`
      const newPrefix =
        newFolder === "" ? newName : `${newFolder}/${newName}`

      await client.query(
        `UPDATE project_files
            SET folder_path = CASE
                  WHEN folder_path = $2 THEN $3
                  ELSE $3 || substr(folder_path, length($2) + 1)
                END
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

    const oldKey = existing.s3Key
      ?? logicalKeyForFile({
        userId: input.userId,
        projectId: input.projectId,
        folderPath: existing.folderPath,
        name: existing.name,
      })
    const newKey = file.s3Key
      ?? logicalKeyForFile({
        userId: input.userId,
        projectId: input.projectId,
        folderPath: file.folderPath,
        name: file.name,
      })

    if (oldKey !== newKey) {
      await journal(client, {
        projectId: input.projectId,
        key: oldKey,
        op: "delete",
        eventId: input.eventId ? `${input.eventId}:del` : null,
        payload: {
          fileId: file.id,
          name: existing.name,
          folderPath: existing.folderPath,
          isFolder: existing.isFolder,
        },
      })
      const seq = await journal(client, {
        projectId: input.projectId,
        key: newKey,
        op: "put",
        size: file.isFolder ? 0 : file.sizeBytes,
        eventId: input.eventId ? `${input.eventId}:put` : null,
        payload: {
          fileId: file.id,
          name: file.name,
          folderPath: file.folderPath,
          isFolder: file.isFolder,
        },
      })
      await client.query(`UPDATE project_files SET last_seq = $2 WHERE id = $1`, [
        file.id,
        seq,
      ])
    }

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
    const local = await db.query<{ id: string; s3Key: string; etag: string | null }>(
      `SELECT id, s3_key AS "s3Key", etag
         FROM project_files
        WHERE project_id = $1 AND s3_key IS NOT NULL AND is_folder = FALSE`,
      [projectId],
    )
    const localByKey = new Map(local.rows.map((r) => [r.s3Key, r]))

    for (const [key, head] of remoteKeys) {
      const name = key.slice(key.lastIndexOf("/") + 1)
      const folderPath = folderPathFromKey(userId, projectId, key, name)
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
          payload: { fileId: row.id, name, folderPath, isFolder: false },
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
  op: "put" | "delete"
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
