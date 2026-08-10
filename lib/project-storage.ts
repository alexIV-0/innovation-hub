import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { listAllProjectFiles } from "@/lib/repositories/project-files"
import { buildProjectObjectKey, getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

/**
 * R2/S3 layout for a project (replaces the Google Drive tree):
 *
 *   projects/{userId}/{projectId}/project-meta.json
 *   projects/{userId}/{projectId}/options/folderState.json
 *   projects/{userId}/{projectId}/options/options.json
 *   projects/{userId}/{projectId}/{folderPath}/{uuid}-{name}   — user files
 *
 * Folder structure for the cabinet lives in Postgres `project_files`.
 * The `options` service folder is never listed in the UI.
 */

export const OPTIONS_FOLDER_NAME = "options"
export const FOLDER_STATE_FILE_NAME = "folderState.json"
export const OPTIONS_FILE_NAME = "options.json"
export const PROJECT_META_FILE_NAME = "project-meta.json"

export class ProjectStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectStorageError"
  }
}

export type ProjectStorageFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  s3Key: string | null
  folderPath: string
  children?: ProjectStorageFile[]
}

export type ProjectFolderState = {
  schemaVersion: number
  enabled: boolean
  disabledReason: string | null
  disabledAt: string | null
  lastActivityAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type ExposedOptionValue = string | number | boolean

export type ExposedOption = {
  path: string[]
  key: string
  label: string
  description: string | null
  type: "boolean" | "number" | "string"
  value: ExposedOptionValue
}

export type ProjectStorageState = {
  files: ProjectStorageFile[]
  folderState: ProjectFolderState | null
  options: ExposedOption[]
  optionsFileExists: boolean
  available: boolean
}

export function siteUpdatedBy(email: string): string {
  return `site:${email.toLowerCase()}`
}

export function projectMetaKey(userId: string, projectId: string): string {
  return buildProjectObjectKey(userId, projectId, PROJECT_META_FILE_NAME)
}

export function projectFolderStateKey(userId: string, projectId: string): string {
  return buildProjectObjectKey(
    userId,
    projectId,
    `${OPTIONS_FOLDER_NAME}/${FOLDER_STATE_FILE_NAME}`,
  )
}

export function projectOptionsKey(userId: string, projectId: string): string {
  return buildProjectObjectKey(
    userId,
    projectId,
    `${OPTIONS_FOLDER_NAME}/${OPTIONS_FILE_NAME}`,
  )
}

/** Object key for a user upload under a logical folder path. */
export function projectUploadObjectKey(
  userId: string,
  projectId: string,
  folderPath: string,
  fileName: string,
): string {
  const safe = fileName.replace(/^\/+/, "").replace(/\.\./g, "_")
  const folder = folderPath.replace(/^\/+|\/+$/g, "")
  const relative = folder
    ? `${folder}/${safe}`
    : safe
  return buildProjectObjectKey(userId, projectId, relative)
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseFolderState(data: unknown): ProjectFolderState | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  return {
    schemaVersion: typeof d.schemaVersion === "number" ? d.schemaVersion : 1,
    enabled: d.enabled === true,
    disabledReason:
      typeof d.disabledReason === "string" ? d.disabledReason : null,
    disabledAt: typeof d.disabledAt === "string" ? d.disabledAt : null,
    lastActivityAt:
      typeof d.lastActivityAt === "string" ? d.lastActivityAt : null,
    updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : null,
    updatedBy: typeof d.updatedBy === "string" ? d.updatedBy : null,
  }
}

function collectExposedOptions(
  node: unknown,
  path: string[],
  out: ExposedOption[],
): void {
  if (!node || typeof node !== "object") return

  if (Array.isArray(node)) {
    node.forEach((child, index) =>
      collectExposedOptions(child, [...path, String(index)], out),
    )
    return
  }

  const obj = node as Record<string, unknown>
  if (obj.exposedToSite === true) {
    const value = obj.value
    const type = typeof value
    if (type === "boolean" || type === "number" || type === "string") {
      const key = path[path.length - 1] ?? "option"
      out.push({
        path,
        key,
        label:
          typeof obj.label === "string" && obj.label.trim()
            ? obj.label
            : typeof obj.title === "string" && obj.title.trim()
              ? obj.title
              : key,
        description:
          typeof obj.description === "string" && obj.description.trim()
            ? obj.description
            : null,
        type,
        value: value as ExposedOptionValue,
      })
    }
    return
  }

  for (const [key, child] of Object.entries(obj)) {
    collectExposedOptions(child, [...path, key], out)
  }
}

export function extractExposedOptions(root: unknown): ExposedOption[] {
  const out: ExposedOption[] = []
  collectExposedOptions(root, [], out)
  return out
}

export async function getObjectText(key: string): Promise<string | null> {
  if (!isS3Configured()) return null
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const body = response.Body
    if (!body) return null
    return await body.transformToString()
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
    if (status === 404) return null
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name: unknown }).name)
        : ""
    if (name === "NoSuchKey" || name === "NotFound") return null
    throw error
  }
}

async function putObjectText(
  key: string,
  content: string,
  contentType = "application/json",
): Promise<void> {
  if (!isS3Configured()) {
    throw new ProjectStorageError("Object storage is not configured.")
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: getS3Bucket(),
      Key: key,
      Body: content,
      ContentType: contentType,
    }),
  )
}

export async function objectExists(key: string): Promise<boolean> {
  if (!isS3Configured()) return false
  try {
    await getS3Client().send(
      new HeadObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    return true
  } catch {
    return false
  }
}

export async function writeProjectMeta(input: {
  userId: string
  projectId: string
  name: string
  description: string
  ownerEmail: string
  createdAt?: string
}): Promise<void> {
  const payload = {
    name: input.name,
    description: input.description,
    ownerEmail: input.ownerEmail,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  await putObjectText(
    projectMetaKey(input.userId, input.projectId),
    JSON.stringify(payload, null, 2),
  )
}

function isHiddenName(name: string): boolean {
  const n = name.toLowerCase()
  return n === OPTIONS_FOLDER_NAME || n === PROJECT_META_FILE_NAME
}

function toStorageFile(row: ProjectFileRecord): ProjectStorageFile {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.isFolder
      ? "application/vnd.folder"
      : row.contentType || "application/octet-stream",
    isFolder: row.isFolder,
    sizeBytes: row.isFolder ? null : row.sizeBytes,
    modifiedAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    s3Key: row.s3Key,
    folderPath: row.folderPath,
  }
}

function buildTree(rows: ProjectFileRecord[]): ProjectStorageFile[] {
  const visible = rows.filter((r) => !isHiddenName(r.name))
  const byParent = new Map<string, ProjectFileRecord[]>()

  for (const row of visible) {
    const key = row.folderPath
    const list = byParent.get(key)
    if (list) list.push(row)
    else byParent.set(key, [row])
  }

  const sortNodes = (a: ProjectStorageFile, b: ProjectStorageFile) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  }

  function childrenOf(folderPath: string): ProjectStorageFile[] {
    const rowsHere = byParent.get(folderPath) ?? []
    const nodes = rowsHere.map(toStorageFile)
    for (const node of nodes) {
      if (!node.isFolder) continue
      const childPath =
        folderPath === "" ? node.name : `${folderPath}/${node.name}`
      node.children = childrenOf(childPath).sort(sortNodes)
    }
    return nodes.sort(sortNodes)
  }

  return childrenOf("")
}

/**
 * Cabinet view: nested file tree from Postgres + automation JSON from R2.
 */
export async function loadProjectStorageState(
  userId: string,
  projectId: string,
): Promise<ProjectStorageState> {
  const available = isS3Configured()
  const rows = await listAllProjectFiles(projectId)
  const files = buildTree(rows)

  if (!available) {
    return {
      files,
      folderState: null,
      options: [],
      optionsFileExists: false,
      available: false,
    }
  }

  const [stateRaw, optionsRaw] = await Promise.all([
    getObjectText(projectFolderStateKey(userId, projectId)),
    getObjectText(projectOptionsKey(userId, projectId)),
  ])

  const folderState = stateRaw
    ? parseFolderState(parseJson(stateRaw))
    : null
  const optionsFileExists = optionsRaw != null
  const options = optionsFileExists
    ? extractExposedOptions(parseJson(optionsRaw ?? "null"))
    : []

  return {
    files,
    folderState,
    options,
    optionsFileExists,
    available: true,
  }
}

export async function setProjectAutomationEnabled(input: {
  userId: string
  projectId: string
  enabled: boolean
  updatedBy: string
}): Promise<ProjectFolderState> {
  const key = projectFolderStateKey(input.userId, input.projectId)
  const raw = await getObjectText(key)
  if (raw == null) {
    throw new ProjectStorageError(
      "Automation is not set up for this project yet.",
    )
  }

  const parsed = parseJson(raw)
  const current =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}

  const now = new Date().toISOString()
  const next: Record<string, unknown> = {
    schemaVersion: 1,
    ...current,
    enabled: input.enabled,
    disabledReason: input.enabled ? null : "manual",
    disabledAt: input.enabled ? null : now,
    updatedAt: now,
    updatedBy: input.updatedBy,
  }

  await putObjectText(key, JSON.stringify(next, null, 2))

  const state = parseFolderState(next)
  if (!state) {
    throw new ProjectStorageError("Failed to update folder state.")
  }
  return state
}

export async function updateProjectExposedOptions(input: {
  userId: string
  projectId: string
  changes: { path: string[]; value: ExposedOptionValue }[]
}): Promise<ExposedOption[]> {
  const key = projectOptionsKey(input.userId, input.projectId)
  const raw = await getObjectText(key)
  if (raw == null) {
    throw new ProjectStorageError(
      "Automation is not set up for this project yet.",
    )
  }

  const root = parseJson(raw)
  if (!root || typeof root !== "object") {
    throw new ProjectStorageError(
      "options.json is not valid JSON; cannot apply changes.",
    )
  }

  for (const change of input.changes) {
    let node: unknown = root
    for (const segment of change.path) {
      if (!node || typeof node !== "object") {
        node = undefined
        break
      }
      node = Array.isArray(node)
        ? node[Number.parseInt(segment, 10)]
        : (node as Record<string, unknown>)[segment]
    }

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new ProjectStorageError(
        `Parameter "${change.path.join(".")}" was not found in options.json.`,
      )
    }
    const target = node as Record<string, unknown>
    if (target.exposedToSite !== true) {
      throw new ProjectStorageError(
        `Parameter "${change.path.join(".")}" is not editable from the site.`,
      )
    }
    if (typeof target.value !== typeof change.value) {
      throw new ProjectStorageError(
        `Parameter "${change.path.join(".")}" has a different value type.`,
      )
    }
    target.value = change.value
  }

  await putObjectText(key, JSON.stringify(root, null, 2))
  return extractExposedOptions(root)
}
