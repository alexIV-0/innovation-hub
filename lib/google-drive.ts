import { google, type drive_v3 } from "googleapis"
import { Readable } from "node:stream"

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"

export class GoogleDriveConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GoogleDriveConfigError"
  }
}

export class GoogleDriveError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "GoogleDriveError"
  }
}

type DriveBaseConfig = {
  rootFolderId: string
  sharedDriveId?: string
}

type DriveOAuthConfig = DriveBaseConfig & {
  mode: "oauth"
  clientId: string
  clientSecret: string
  refreshToken: string
}

type DriveServiceAccountConfig = DriveBaseConfig & {
  mode: "service_account"
  clientEmail: string
  privateKey: string
}

type DriveConfig = DriveOAuthConfig | DriveServiceAccountConfig

function readRootFolderId(): string | null {
  return (
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ||
    process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim() ||
    null
  )
}

/**
 * Preferred when org policy blocks SA keys (`iam.disableServiceAccountKeyCreation`):
 * OAuth refresh token for a Google user that owns/can edit the root folder.
 */
function readOAuthDriveConfig(): DriveOAuthConfig | null {
  const rootFolderId = readRootFolderId()
  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()

  if (!rootFolderId || !clientId || !clientSecret || !refreshToken) {
    return null
  }

  return {
    mode: "oauth",
    clientId,
    clientSecret,
    refreshToken,
    rootFolderId,
    sharedDriveId: process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim() || undefined,
  }
}

/** Legacy: only works if the org allows creating service-account keys. */
function readServiceAccountDriveConfig(): DriveServiceAccountConfig | null {
  const rootFolderId = readRootFolderId()
  const clientEmail =
    process.env.GOOGLE_DRIVE_CLIENT_EMAIL?.trim() ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim()
  const privateKeyRaw =
    process.env.GOOGLE_DRIVE_PRIVATE_KEY?.trim() ||
    process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim()

  if (!rootFolderId || !clientEmail || !privateKeyRaw) {
    return null
  }

  return {
    mode: "service_account",
    clientEmail,
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    rootFolderId,
    sharedDriveId: process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim() || undefined,
  }
}

function readDriveConfig(): DriveConfig | null {
  // Prefer OAuth — works under Secure-by-Default org policies that ban SA keys.
  return readOAuthDriveConfig() ?? readServiceAccountDriveConfig()
}

export function isGoogleDriveConfigured(): boolean {
  return readDriveConfig() !== null
}

export function requireGoogleDriveConfig(): DriveConfig {
  const config = readDriveConfig()
  if (!config) {
    throw new GoogleDriveConfigError(
      "Google Drive is not configured. Prefer OAuth: set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, and GOOGLE_DRIVE_ROOT_FOLDER_ID (run `node scripts/google-drive-oauth.mjs`). Service-account keys are optional and often blocked by org policy iam.disableServiceAccountKeyCreation.",
    )
  }
  return config
}

function buildAuth(config: DriveConfig) {
  if (config.mode === "oauth") {
    const oauth2 = new google.auth.OAuth2(config.clientId, config.clientSecret)
    oauth2.setCredentials({ refresh_token: config.refreshToken })
    return oauth2
  }

  return new google.auth.JWT({
    email: config.clientEmail,
    key: config.privateKey,
    scopes: [DRIVE_SCOPE],
  })
}

function getDrive(): { drive: drive_v3.Drive; config: DriveConfig } {
  const config = requireGoogleDriveConfig()
  // googleapis nests its own google-auth-library; cast avoids duplicate-type clash.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auth = buildAuth(config) as any
  return { drive: google.drive({ version: "v3", auth }), config }
}

function driveFlags(config: DriveConfig) {
  return {
    supportsAllDrives: true,
    ...(config.sharedDriveId
      ? { driveId: config.sharedDriveId, includeItemsFromAllDrives: true }
      : {}),
  }
}

/** Sanitize a folder/file name for Drive (no path separators / control chars). */
export function sanitizeDriveName(raw: string, fallback = "untitled"): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
  return cleaned || fallback
}

type ChildFolderHit = {
  id: string
  createdTime: string | null
}

/**
 * List every non-trashed sibling folder with this exact name.
 * Drive allows duplicate names under the same parent — callers that need a
 * single canonical folder must consolidate.
 */
async function listChildFoldersByName(
  drive: drive_v3.Drive,
  config: DriveConfig,
  parentId: string,
  name: string,
): Promise<ChildFolderHit[]> {
  const escaped = name.replace(/'/g, "\\'")
  const hits: ChildFolderHit[] = []
  let pageToken: string | undefined

  do {
    const response = await drive.files.list({
      ...driveFlags(config),
      q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "nextPageToken, files(id, createdTime)",
      pageSize: 100,
      pageToken,
      spaces: "drive",
    })
    for (const file of response.data.files ?? []) {
      if (!file.id) continue
      hits.push({ id: file.id, createdTime: file.createdTime ?? null })
    }
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return hits
}

/**
 * Prefer the oldest folder (stable across race winners). Ties break by id so
 * every concurrent caller converges on the same canonical id.
 */
function pickCanonicalFolderId(hits: ChildFolderHit[]): string {
  const sorted = [...hits].sort((a, b) => {
    const aTime = a.createdTime ?? ""
    const bTime = b.createdTime ?? ""
    if (aTime !== bTime) return aTime < bTime ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return sorted[0]!.id
}

/**
 * Keep the canonical sibling; move the rest to trash. Best-effort — a trash
 * failure must not block returning the canonical id.
 */
async function consolidateDuplicateFolders(
  drive: drive_v3.Drive,
  config: DriveConfig,
  hits: ChildFolderHit[],
  context: { parentId: string; name: string },
): Promise<string> {
  const canonicalId = pickCanonicalFolderId(hits)
  const duplicates = hits.filter((h) => h.id !== canonicalId)
  if (duplicates.length === 0) return canonicalId

  console.warn("[google-drive] consolidating duplicate folders", {
    name: context.name,
    parentId: context.parentId,
    canonicalId,
    trashedIds: duplicates.map((d) => d.id),
  })

  await Promise.all(
    duplicates.map(async (dup) => {
      try {
        await drive.files.update({
          ...driveFlags(config),
          fileId: dup.id,
          requestBody: { trashed: true },
        })
      } catch (error) {
        console.error("[google-drive] failed to trash duplicate folder", {
          folderId: dup.id,
          name: context.name,
          error,
        })
      }
    }),
  )

  return canonicalId
}

/** In-process lock so concurrent find-or-create for the same parent+name share one promise. */
const findOrCreateFolderLocks = new Map<string, Promise<string>>()

export const DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

export type DriveChildFile = {
  id: string
  name: string
  mimeType: string
  sizeBytes: number | null
  createdTime: string | null
  modifiedTime: string | null
}

/** List all non-trashed direct children of a Drive folder (paginated). */
export async function listDriveChildren(
  folderId: string,
): Promise<DriveChildFile[]> {
  const { drive, config } = getDrive()
  const files: DriveChildFile[] = []
  let pageToken: string | undefined

  try {
    do {
      const response = await drive.files.list({
        ...driveFlags(config),
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)",
        pageSize: 1000,
        pageToken,
        spaces: "drive",
      })
      for (const file of response.data.files ?? []) {
        if (!file.id || !file.name) continue
        const size =
          file.size == null ? NaN : Number.parseInt(String(file.size), 10)
        files.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType ?? "application/octet-stream",
          sizeBytes: Number.isFinite(size) ? size : null,
          createdTime: file.createdTime ?? null,
          modifiedTime: file.modifiedTime ?? null,
        })
      }
      pageToken = response.data.nextPageToken ?? undefined
    } while (pageToken)
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to list Drive folder.",
      { cause: error },
    )
  }

  return files
}

/** Find a direct child by exact name; optionally restrict to folders. */
export async function findDriveChildByName(
  parentId: string,
  name: string,
  options?: { folderOnly?: boolean },
): Promise<DriveChildFile | null> {
  const { drive, config } = getDrive()
  const escaped = name.replace(/'/g, "\\'")
  const mimeClause = options?.folderOnly
    ? ` and mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`
    : ""

  try {
    const response = await drive.files.list({
      ...driveFlags(config),
      q: `'${parentId}' in parents and name = '${escaped}'${mimeClause} and trashed = false`,
      fields: "files(id, name, mimeType, size, createdTime, modifiedTime)",
      pageSize: 1,
      spaces: "drive",
    })
    const file = response.data.files?.[0]
    if (!file?.id || !file.name) return null
    const size =
      file.size == null ? NaN : Number.parseInt(String(file.size), 10)
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType ?? "application/octet-stream",
      sizeBytes: Number.isFinite(size) ? size : null,
      createdTime: file.createdTime ?? null,
      modifiedTime: file.modifiedTime ?? null,
    }
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to search Drive folder.",
      { cause: error },
    )
  }
}

/** Fetch id/name/mimeType/parents for a file; null when missing. */
export async function getDriveFileInfo(fileId: string): Promise<{
  id: string
  name: string
  mimeType: string
  parents: string[]
} | null> {
  const { drive } = getDrive()
  try {
    const response = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, parents",
      supportsAllDrives: true,
    })
    const file = response.data
    if (!file.id) return null
    return {
      id: file.id,
      name: file.name ?? "",
      mimeType: file.mimeType ?? "application/octet-stream",
      parents: file.parents ?? [],
    }
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null
    if (status === 404) return null
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to read Drive file.",
      { cause: error },
    )
  }
}

/** Download the raw text content of a Drive file. */
export async function downloadDriveTextFile(fileId: string): Promise<string> {
  const { drive } = getDrive()
  try {
    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "text" },
    )
    const data = response.data
    return typeof data === "string" ? data : JSON.stringify(data)
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error
        ? error.message
        : "Failed to download Drive file.",
      { cause: error },
    )
  }
}

/** Overwrite the content of an existing Drive file. */
export async function updateDriveTextFile(input: {
  fileId: string
  content: string
  mimeType?: string
}): Promise<void> {
  const { drive } = getDrive()
  try {
    await drive.files.update({
      fileId: input.fileId,
      supportsAllDrives: true,
      media: {
        mimeType: input.mimeType ?? "application/json",
        body: Readable.from([input.content]),
      },
    })
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to update Drive file.",
      { cause: error },
    )
  }
}

async function createDriveFolderUnique(input: {
  name: string
  parentId: string
}): Promise<string> {
  const { drive, config } = getDrive()
  const name = sanitizeDriveName(input.name)

  try {
    const response = await drive.files.create({
      ...driveFlags(config),
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [input.parentId],
      },
      fields: "id",
    })
    const id = response.data.id
    if (!id) {
      throw new GoogleDriveError("Drive did not return a folder id.")
    }
    return id
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to create Drive folder.",
      { cause: error },
    )
  }
}

/**
 * Idempotent find-or-create: never leave duplicate siblings with the same name.
 * Handles races by re-listing after create and trashing non-canonical copies.
 */
async function findOrCreateDriveFolder(input: {
  name: string
  parentId: string
}): Promise<string> {
  const { drive, config } = getDrive()
  const name = sanitizeDriveName(input.name)
  const parentId = input.parentId
  const lockKey = `${parentId}\0${name}`

  const inFlight = findOrCreateFolderLocks.get(lockKey)
  if (inFlight) return inFlight

  const run = (async (): Promise<string> => {
    const existing = await listChildFoldersByName(drive, config, parentId, name)
    if (existing.length > 0) {
      return consolidateDuplicateFolders(drive, config, existing, {
        parentId,
        name,
      })
    }

    await createDriveFolderUnique({ name, parentId })

    // Re-list after create: another process may have created a sibling in the
    // same window. Every winner converges on the oldest id and trashes extras.
    const afterCreate = await listChildFoldersByName(
      drive,
      config,
      parentId,
      name,
    )
    if (afterCreate.length === 0) {
      throw new GoogleDriveError(
        "Drive folder disappeared immediately after create.",
      )
    }
    return consolidateDuplicateFolders(drive, config, afterCreate, {
      parentId,
      name,
    })
  })().finally(() => {
    if (findOrCreateFolderLocks.get(lockKey) === run) {
      findOrCreateFolderLocks.delete(lockKey)
    }
  })

  findOrCreateFolderLocks.set(lockKey, run)
  return run
}

export async function createDriveFolder(input: {
  name: string
  parentId: string
  /**
   * When false, always create a fresh folder even if a sibling with the same
   * name exists (Drive allows duplicate names). Use for per-entity folders
   * (e.g. projects) that must stay isolated; default true keeps the
   * idempotent find-or-create behavior used for user email folders.
   */
  reuseExisting?: boolean
}): Promise<string> {
  if (input.reuseExisting === false) {
    return createDriveFolderUnique({
      name: input.name,
      parentId: input.parentId,
    })
  }
  return findOrCreateDriveFolder({
    name: input.name,
    parentId: input.parentId,
  })
}

export async function getRootFolderId(): Promise<string> {
  return requireGoogleDriveConfig().rootFolderId
}

export async function ensureUserEmailFolder(email: string): Promise<string> {
  const config = requireGoogleDriveConfig()
  return createDriveFolder({
    name: email.toLowerCase(),
    parentId: config.rootFolderId,
  })
}

export async function writeDriveTextFile(input: {
  name: string
  parentId: string
  content: string
  mimeType?: string
}): Promise<string> {
  const { drive, config } = getDrive()
  const name = sanitizeDriveName(input.name)
  const mimeType = input.mimeType ?? "text/plain"

  try {
    const response = await drive.files.create({
      ...driveFlags(config),
      requestBody: {
        name,
        parents: [input.parentId],
      },
      media: {
        mimeType,
        body: Readable.from([input.content]),
      },
      fields: "id",
    })
    const id = response.data.id
    if (!id) {
      throw new GoogleDriveError("Drive did not return a file id.")
    }
    return id
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to write Drive file.",
      { cause: error },
    )
  }
}

export async function uploadDriveFile(input: {
  name: string
  parentId: string
  mimeType: string
  body: Readable | Buffer
}): Promise<string> {
  const { drive, config } = getDrive()
  const name = sanitizeDriveName(input.name, "upload")
  const body =
    Buffer.isBuffer(input.body) ? Readable.from(input.body) : input.body

  try {
    const response = await drive.files.create({
      ...driveFlags(config),
      requestBody: {
        name,
        parents: [input.parentId],
      },
      media: {
        mimeType: input.mimeType,
        body,
      },
      fields: "id",
    })
    const id = response.data.id
    if (!id) {
      throw new GoogleDriveError("Drive did not return a file id.")
    }
    return id
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to upload Drive file.",
      { cause: error },
    )
  }
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const { drive, config } = getDrive()
  try {
    await drive.files.delete({
      ...driveFlags(config),
      fileId,
    })
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null
    if (status === 404) return
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to delete Drive file.",
      { cause: error },
    )
  }
}

/**
 * Move a file/folder to the Drive trash instead of deleting permanently.
 * Trashed folders are excluded from `findChildFolder` lookups, so a later
 * find-or-create produces a fresh folder. Missing files are treated as done.
 */
export async function trashDriveFile(fileId: string): Promise<void> {
  const { drive, config } = getDrive()
  try {
    await drive.files.update({
      ...driveFlags(config),
      fileId,
      requestBody: { trashed: true },
    })
  } catch (error) {
    const status =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "number"
        ? (error as { code: number }).code
        : null
    if (status === 404) return
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to trash Drive file.",
      { cause: error },
    )
  }
}

export function driveFolderWebLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

export function driveFileWebLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}

/** Walk parent chain to decide whether `fileId` lives under `rootFolderId`. */
export async function isDriveFileUnderFolder(
  fileId: string,
  rootFolderId: string,
): Promise<boolean> {
  if (fileId === rootFolderId) return true
  const seen = new Set<string>()
  let current: string | null = fileId
  while (current) {
    if (current === rootFolderId) return true
    if (seen.has(current)) return false
    seen.add(current)
    const info = await getDriveFileInfo(current)
    if (!info || info.parents.length === 0) return false
    // Prefer the first parent; shared files may have multiple.
    current = info.parents[0] ?? null
  }
  return false
}

export async function renameDriveFile(
  fileId: string,
  name: string,
): Promise<void> {
  const { drive, config } = getDrive()
  try {
    await drive.files.update({
      ...driveFlags(config),
      fileId,
      requestBody: { name: sanitizeDriveName(name) },
    })
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error ? error.message : "Failed to rename Drive file.",
      { cause: error },
    )
  }
}

/** Stream a Drive file's binary content (for cabinet download). */
export async function downloadDriveFileMedia(fileId: string): Promise<{
  body: NodeJS.ReadableStream
  mimeType: string
  name: string
  size: number | null
}> {
  const { drive } = getDrive()
  try {
    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size",
      supportsAllDrives: true,
    })
    const response = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" },
    )
    return {
      body: response.data as NodeJS.ReadableStream,
      mimeType: meta.data.mimeType ?? "application/octet-stream",
      name: meta.data.name ?? "download",
      size: meta.data.size ? Number(meta.data.size) : null,
    }
  } catch (error) {
    throw new GoogleDriveError(
      error instanceof Error
        ? error.message
        : "Failed to download Drive file.",
      { cause: error },
    )
  }
}
