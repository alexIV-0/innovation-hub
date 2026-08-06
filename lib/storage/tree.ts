import { query } from "@/lib/db"
import type { StorageTreeEntry } from "@/lib/storage/types"

const TREE_FIELDS = `
  id,
  project_id AS "projectId",
  folder_path AS "folderPath",
  name,
  is_folder AS "isFolder",
  s3_key AS "s3Key",
  size_bytes::float8 AS "sizeBytes",
  content_type AS "contentType",
  etag,
  content_hash AS "contentHash",
  origin_mtime AS "originMtime",
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  last_seq AS "lastSeq"
`

export async function loadStorageTree(input: {
  projectId: string
  prefix?: string
}): Promise<StorageTreeEntry[]> {
  const folderPrefix = (input.prefix ?? "").replace(/^\/+|\/+$/g, "")

  const result = await query<{
    id: string
    projectId: string
    folderPath: string
    name: string
    isFolder: boolean
    s3Key: string | null
    sizeBytes: number
    contentType: string
    etag: string | null
    contentHash: string | null
    originMtime: number | null
    createdAt: Date
    updatedAt: Date
    lastSeq: string | null
  }>(
    folderPrefix === ""
      ? `SELECT ${TREE_FIELDS}
           FROM project_files
          WHERE project_id = $1 AND deleted_at IS NULL
          ORDER BY folder_path ASC, is_folder DESC, lower(name) ASC`
      : `SELECT ${TREE_FIELDS}
           FROM project_files
          WHERE project_id = $1
            AND deleted_at IS NULL
            AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
          ORDER BY folder_path ASC, is_folder DESC, lower(name) ASC`,
    folderPrefix === "" ? [input.projectId] : [input.projectId, folderPrefix],
  )

  return result.rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    folderPath: row.folderPath,
    name: row.name,
    isFolder: row.isFolder,
    s3Key: row.s3Key,
    sizeBytes: row.sizeBytes,
    contentType: row.contentType,
    etag: row.etag,
    contentHash: row.contentHash,
    originMtime: row.originMtime,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    lastSeq: row.lastSeq != null ? Number(row.lastSeq) : null,
  }))
}
