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

async function findChildFolder(
  drive: drive_v3.Drive,
  config: DriveConfig,
  parentId: string,
  name: string,
): Promise<string | null> {
  const escaped = name.replace(/'/g, "\\'")
  const response = await drive.files.list({
    ...driveFlags(config),
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    spaces: "drive",
  })
  return response.data.files?.[0]?.id ?? null
}

export async function createDriveFolder(input: {
  name: string
  parentId: string
}): Promise<string> {
  const { drive, config } = getDrive()
  const name = sanitizeDriveName(input.name)

  const existing = await findChildFolder(drive, config, input.parentId, name)
  if (existing) return existing

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

export function driveFolderWebLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

export function driveFileWebLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`
}
