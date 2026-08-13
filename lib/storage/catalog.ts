import {
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import { query } from "@/lib/db"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { getLatestCursor } from "@/lib/storage/changes"
import { serializeStorageChange } from "@/lib/storage/delta-format"
import type { StorageChangeRecord } from "@/lib/storage/types"
import {
  CATALOG_FOLDER_NAME,
  isCatalogKey,
  projectPrefix,
} from "@/lib/storage/keys"

export { CATALOG_FOLDER_NAME, isCatalogKey }
export const CATALOG_SNAPSHOT_NAME = "catalog.json"
export const CATALOG_JOURNAL_NAME = "catalog.jsonl"
/** Rebuild snapshot after this many journaled events. */
export const CATALOG_REBUILD_EVERY_N = 200

export function catalogObjectKey(
  userId: string,
  projectId: string,
  fileName: string,
): string {
  return `${projectPrefix(userId, projectId)}${CATALOG_FOLDER_NAME}/${fileName}`
}

async function readObjectText(key: string): Promise<string | null> {
  if (!isS3Configured()) return null
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    return (await response.Body?.transformToString()) ?? null
  } catch {
    return null
  }
}

async function putObjectText(
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  if (!isS3Configured()) return
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

export type CatalogFileRow = {
  fileId: string
  s3Key: string | null
  folderPath: string
  name: string
  isFolder: boolean
  sizeBytes: number
  contentHash: string | null
  originMtime: number | null
  deletedAt: string | null
  lastSeq: number | null
}

export async function loadCatalogRows(
  projectId: string,
): Promise<CatalogFileRow[]> {
  const result = await query<{
    fileId: string
    s3Key: string | null
    folderPath: string
    name: string
    isFolder: boolean
    sizeBytes: number
    contentHash: string | null
    originMtime: number | null
    deletedAt: Date | null
    lastSeq: string | null
  }>(
    `SELECT id AS "fileId",
            s3_key AS "s3Key",
            folder_path AS "folderPath",
            name,
            is_folder AS "isFolder",
            size_bytes::float8 AS "sizeBytes",
            content_hash AS "contentHash",
            origin_mtime AS "originMtime",
            deleted_at AS "deletedAt",
            last_seq::text AS "lastSeq"
       FROM project_files
      WHERE project_id = $1
      ORDER BY folder_path ASC, lower(name) ASC`,
    [projectId],
  )
  return result.rows.map((row) => ({
    fileId: row.fileId,
    s3Key: row.s3Key,
    folderPath: row.folderPath,
    name: row.name,
    isFolder: row.isFolder,
    sizeBytes: row.sizeBytes,
    contentHash: row.contentHash,
    originMtime: row.originMtime,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    lastSeq: row.lastSeq != null ? Number(row.lastSeq) : null,
  }))
}

export async function rebuildCatalogSnapshot(
  userId: string,
  projectId: string,
): Promise<number> {
  const cursor = await getLatestCursor(projectId)
  const files = await loadCatalogRows(projectId)
  const body = JSON.stringify(
    {
      schema: 1,
      projectId,
      cursor,
      generatedAt: new Date().toISOString(),
      files,
    },
    null,
    2,
  )
  await putObjectText(
    catalogObjectKey(userId, projectId, CATALOG_SNAPSHOT_NAME),
    body,
    "application/json",
  )
  // Truncate the jsonl after a successful snapshot.
  await putObjectText(
    catalogObjectKey(userId, projectId, CATALOG_JOURNAL_NAME),
    "",
    "application/x-ndjson",
  )
  return cursor
}

/** Best-effort append of one delta line after Postgres commit. */
export async function appendCatalogJsonl(input: {
  userId: string
  projectId: string
  change: StorageChangeRecord
}): Promise<void> {
  if (!isS3Configured()) return
  try {
    const key = catalogObjectKey(
      input.userId,
      input.projectId,
      CATALOG_JOURNAL_NAME,
    )
    const existing = (await readObjectText(key)) ?? ""
    const line = JSON.stringify(serializeStorageChange(input.change))
    const next = existing
      ? existing.endsWith("\n")
        ? `${existing}${line}\n`
        : `${existing}\n${line}\n`
      : `${line}\n`
    await putObjectText(key, next, "application/x-ndjson")

    const lines = next.split("\n").filter((l) => l.trim().length > 0)
    if (lines.length >= CATALOG_REBUILD_EVERY_N) {
      const { createJob } = await import("@/lib/storage/jobs")
      const { scheduleJob } = await import("@/lib/storage/job-runner")
      const job = await createJob({
        userId: input.userId,
        projectId: input.projectId,
        kind: "recatalog",
        total: 1,
        payload: { reason: "threshold" },
        eventId: `recatalog:${input.projectId}:${input.change.seq}`,
      })
      scheduleJob(job.id)
    }
  } catch (error) {
    console.error("[storage] catalog.jsonl append failed", error)
  }
}
