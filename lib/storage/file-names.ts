import type { PoolClient } from "pg"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-storage"
import { CATALOG_FOLDER_NAME } from "@/lib/storage/keys"
import { StorageWriteError } from "@/lib/storage/errors"

const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f]/
const RESERVED_WIN =
  /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_NAME_BYTES = 180
const MAX_PATH_BYTES = 1000

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8")
}

/** Throws StorageWriteError(400) if the logical file/folder name is illegal. */
export function validateLogicalName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new StorageWriteError("Name cannot be empty.", 400)
  }
  if (trimmed === "." || trimmed === "..") {
    throw new StorageWriteError("Name cannot be '.' or '..'.", 400)
  }
  if (ILLEGAL_CHARS.test(trimmed)) {
    throw new StorageWriteError(
      "Name contains characters that are not allowed.",
      400,
    )
  }
  if (/[ .]$/.test(trimmed)) {
    throw new StorageWriteError("Name cannot end with a space or a period.", 400)
  }
  if (RESERVED_WIN.test(trimmed)) {
    throw new StorageWriteError("This name is reserved by Windows.", 400)
  }
  if (utf8Bytes(trimmed) > MAX_NAME_BYTES) {
    throw new StorageWriteError(
      `Name must be at most ${MAX_NAME_BYTES} bytes.`,
      400,
    )
  }
  if (trimmed.toLowerCase() === OPTIONS_FOLDER_NAME) {
    throw new StorageWriteError("This folder name is reserved.", 403)
  }
  if (trimmed.toLowerCase() === CATALOG_FOLDER_NAME) {
    throw new StorageWriteError("This folder name is reserved.", 403)
  }
  return trimmed
}

export function assertLogicalPath(folderPath: string, name: string): void {
  const folder = folderPath.replace(/^\/+|\/+$/g, "")
  const full = folder ? `${folder}/${name}` : name
  if (utf8Bytes(full) > MAX_PATH_BYTES) {
    throw new StorageWriteError(
      `Logical path must be at most ${MAX_PATH_BYTES} bytes.`,
      400,
    )
  }
}

export function folderPrefix(folderPath: string, name: string): string {
  const folder = folderPath.replace(/^\/+|\/+$/g, "")
  return folder ? `${folder}/${name}` : name
}

export function isMoveIntoSelf(
  oldPrefix: string,
  newFolderPath: string,
): boolean {
  const dest = newFolderPath.replace(/^\/+|\/+$/g, "")
  return dest === oldPrefix || dest.startsWith(`${oldPrefix}/`)
}

export async function nameTaken(
  client: PoolClient,
  input: {
    projectId: string
    folderPath: string
    name: string
    excludeId?: string
  },
): Promise<boolean> {
  const result = await client.query<{ id: string }>(
    `SELECT id
       FROM project_files
      WHERE project_id = $1
        AND lower(folder_path) = lower($2)
        AND lower(name) = lower($3)
        AND deleted_at IS NULL
        AND ($4::text IS NULL OR id <> $4)
      LIMIT 1`,
    [
      input.projectId,
      input.folderPath,
      input.name,
      input.excludeId ?? null,
    ],
  )
  return result.rows.length > 0
}

export async function assertNameFree(
  client: PoolClient,
  input: {
    projectId: string
    folderPath: string
    name: string
    excludeId?: string
  },
): Promise<void> {
  if (await nameTaken(client, input)) {
    throw new StorageWriteError(
      "A file or folder with that name already exists.",
      409,
    )
  }
}

function splitBaseExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf(".")
  if (i <= 0) return { base: name, ext: "" }
  return { base: name.slice(0, i), ext: name.slice(i) }
}

export function withCopySuffix(name: string, n: number): string {
  if (n < 2) return name
  const { base, ext } = splitBaseExt(name)
  return `${base} (${n})${ext}`
}

export async function allocateUniqueName(
  client: PoolClient,
  input: { projectId: string; folderPath: string; name: string },
): Promise<string> {
  const existing = await client.query<{ name: string }>(
    `SELECT name
       FROM project_files
      WHERE project_id = $1
        AND lower(folder_path) = lower($2)
        AND deleted_at IS NULL`,
    [input.projectId, input.folderPath],
  )
  const taken = new Set(existing.rows.map((r) => r.name.toLowerCase()))
  if (!taken.has(input.name.toLowerCase())) return input.name
  for (let n = 2; n < 1000; n++) {
    const candidate = withCopySuffix(input.name, n)
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  throw new StorageWriteError("Could not allocate a unique name.", 409)
}
