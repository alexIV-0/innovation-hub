import {
  DRIVE_FOLDER_MIME_TYPE,
  downloadDriveTextFile,
  findDriveChildByName,
  isGoogleDriveConfigured,
  listDriveChildren,
  type DriveChildFile,
  updateDriveTextFile,
} from "@/lib/google-drive"
import type { ProjectRecord } from "@/lib/domain-types"
import {
  createProject,
  findProjectByDriveFolderId,
  listProjectsByUserId,
  updateProject,
} from "@/lib/repositories/projects"

/**
 * Each project Drive folder may contain a service subfolder `options` managed
 * by external automation:
 *
 *   {project}/options/folderState.json — automation on/off state
 *   {project}/options/options.json     — automation parameters; entries with
 *                                        `exposedToSite: true` are editable
 *                                        from the cabinet
 *
 * The `options` folder is never shown in the cabinet file list, but both
 * files are read (and written) from inside it.
 */
export const OPTIONS_FOLDER_NAME = "options"
const FOLDER_STATE_FILE_NAME = "folderState.json"
const OPTIONS_FILE_NAME = "options.json"
/** Internal meta file written on project creation; hidden from the cabinet. */
const PROJECT_META_FILE_NAME = "project-meta.json"

/** Thrown when the automation files are missing/invalid (client error, 409). */
export class ProjectDriveStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ProjectDriveStateError"
  }
}

export type ProjectDriveFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  /** Present (possibly empty) on folders once their contents are loaded. */
  children?: ProjectDriveFile[]
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
  /** Path of keys inside options.json pointing at the parameter node. */
  path: string[]
  key: string
  label: string
  description: string | null
  type: "boolean" | "number" | "string"
  value: ExposedOptionValue
}

export type ProjectDriveState = {
  files: ProjectDriveFile[]
  /** Null when the options folder or folderState.json does not exist. */
  folderState: ProjectFolderState | null
  /** Parameters from options.json flagged with `exposedToSite: true`. */
  options: ExposedOption[]
  /**
   * Whether `options/options.json` physically exists in the project's Drive
   * folder yet. This is the automation-pipeline signal that gates the
   * cabinet UI: before it appears, the project only shows its chat; once it
   * appears, the usual file browser + automation panel take over. Distinct
   * from `folderState`, which tracks the separate on/off toggle file.
   */
  optionsFileExists: boolean
}

/**
 * Identity written into `updatedBy` when the site changes automation files.
 * TODO: replace with the final updatedBy policy once provided.
 */
export function siteUpdatedBy(email: string): string {
  return `site:${email.toLowerCase()}`
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

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Recursively collect parameter nodes flagged `exposedToSite: true`.
 * A parameter node is expected to carry its editable value in `value`
 * (boolean / number / string). Other fields (`label`, `description`) are
 * used for display when present.
 */
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

function toProjectDriveFile(child: {
  id: string
  name: string
  mimeType: string
  sizeBytes: number | null
  createdTime: string | null
  modifiedTime: string | null
}): ProjectDriveFile {
  return {
    id: child.id,
    name: child.name,
    mimeType: child.mimeType,
    isFolder: child.mimeType === DRIVE_FOLDER_MIME_TYPE,
    sizeBytes: child.sizeBytes,
    modifiedAt: child.modifiedTime,
    createdAt: child.createdTime,
  }
}

function isHiddenEntry(child: { name: string; mimeType: string }): boolean {
  const name = child.name.toLowerCase()
  if (
    child.mimeType === DRIVE_FOLDER_MIME_TYPE &&
    name === OPTIONS_FOLDER_NAME
  ) {
    return true
  }
  return name === PROJECT_META_FILE_NAME
}

function sortEntries(a: ProjectDriveFile, b: ProjectDriveFile): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
  return (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "")
}

/**
 * Bails out of recursing forever into pathological/looped folder trees.
 * Legitimate project structures are expected to be shallow (a handful of
 * levels at most).
 */
const MAX_TREE_DEPTH = 8

/**
 * Recursively lists a folder's visible entries (the `options` service
 * folder and `project-meta.json` are hidden at every level, not just the
 * root) and, for each subfolder, its own contents — so the cabinet can
 * render the project's real structure instead of only the top level.
 */
async function buildFileTree(
  rawChildren: DriveChildFile[],
  depth: number,
): Promise<ProjectDriveFile[]> {
  const nodes = rawChildren
    .filter((c) => !isHiddenEntry(c))
    .map(toProjectDriveFile)
    .sort(sortEntries)

  if (depth >= MAX_TREE_DEPTH) return nodes

  await Promise.all(
    nodes.map(async (node) => {
      if (!node.isFolder) return
      try {
        const rawSubChildren = await listDriveChildren(node.id)
        node.children = await buildFileTree(rawSubChildren, depth + 1)
      } catch (error) {
        console.error("[project-drive] failed to list subfolder", {
          folderId: node.id,
          error,
        })
        node.children = []
      }
    }),
  )

  return nodes
}

/**
 * Live view of a project Drive folder: the full visible file tree (options
 * folder and project-meta.json excluded at every level) + automation state
 * read from options/*.json.
 */
export async function loadProjectDriveState(
  driveFolderId: string,
): Promise<ProjectDriveState> {
  const children = await listDriveChildren(driveFolderId)

  const optionsFolder =
    children.find(
      (c) =>
        c.mimeType === DRIVE_FOLDER_MIME_TYPE &&
        c.name.toLowerCase() === OPTIONS_FOLDER_NAME,
    ) ?? null

  const files = await buildFileTree(children, 0)

  let folderState: ProjectFolderState | null = null
  let options: ExposedOption[] = []
  let optionsFileExists = false

  if (optionsFolder) {
    const [stateFile, optionsFile] = await Promise.all([
      findDriveChildByName(optionsFolder.id, FOLDER_STATE_FILE_NAME),
      findDriveChildByName(optionsFolder.id, OPTIONS_FILE_NAME),
    ])

    if (stateFile) {
      folderState = parseFolderState(
        parseJson(await downloadDriveTextFile(stateFile.id)),
      )
    }
    if (optionsFile) {
      optionsFileExists = true
      options = extractExposedOptions(
        parseJson(await downloadDriveTextFile(optionsFile.id)),
      )
    }
  }

  return { files, folderState, options, optionsFileExists }
}

/** True for a Postgres unique-violation error (pg driver sets `code: "23505"`). */
function isUniqueViolation(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  )
}

/** Best-effort read of the human description written at project creation. */
async function readProjectMetaDescription(
  driveFolderId: string,
): Promise<string> {
  try {
    const metaFile = await findDriveChildByName(
      driveFolderId,
      PROJECT_META_FILE_NAME,
    )
    if (!metaFile) return ""
    const parsed = parseJson(await downloadDriveTextFile(metaFile.id))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const description = (parsed as Record<string, unknown>).description
      if (typeof description === "string") return description
    }
  } catch (error) {
    console.error("[project-drive] failed to read project-meta.json", error)
  }
  return ""
}

/** Best-effort read of `options/folderState.json#enabled`; null when absent/unreadable. */
async function readFolderStateEnabled(
  driveFolderId: string,
): Promise<boolean | null> {
  try {
    const optionsFolder = await findDriveChildByName(
      driveFolderId,
      OPTIONS_FOLDER_NAME,
      { folderOnly: true },
    )
    if (!optionsFolder) return null
    const stateFile = await findDriveChildByName(
      optionsFolder.id,
      FOLDER_STATE_FILE_NAME,
    )
    if (!stateFile) return null
    const state = parseFolderState(
      parseJson(await downloadDriveTextFile(stateFile.id)),
    )
    return state?.enabled ?? null
  } catch (error) {
    console.error("[project-drive] failed to read folderState.json in list scan", error)
    return null
  }
}

/**
 * Google Drive is the source of truth for *which* projects exist and
 * whether automation is on: any subfolder directly under the user's Drive
 * folder is a project, whether it was created from the cabinet ("New
 * project") or dropped there by the desktop app / by hand. Postgres stays
 * internal bookkeeping (the id other tables reference, a description cache)
 * — this reconciles it against the live folder listing rather than trusting
 * it as the list of projects.
 */
export async function listUserProjectsFromDrive(
  userId: string,
  userDriveFolderId: string,
): Promise<ProjectRecord[]> {
  const children = await listDriveChildren(userDriveFolderId)
  const folders = children.filter((c) => c.mimeType === DRIVE_FOLDER_MIME_TYPE)

  const synced = await Promise.all(
    folders.map(async (folder) => {
      const [existing, enabledFromDrive] = await Promise.all([
        findProjectByDriveFolderId(folder.id),
        readFolderStateEnabled(folder.id),
      ])

      if (existing) {
        const patch: { name?: string; isActive?: boolean } = {}
        if (existing.name !== folder.name) patch.name = folder.name
        if (
          enabledFromDrive !== null &&
          enabledFromDrive !== existing.isActive
        ) {
          patch.isActive = enabledFromDrive
        }
        if (Object.keys(patch).length === 0) return existing
        return (await updateProject(existing.id, userId, patch)) ?? existing
      }

      const description = await readProjectMetaDescription(folder.id)
      let created: ProjectRecord
      try {
        created = await createProject({
          userId,
          name: folder.name,
          description,
          driveFolderId: folder.id,
        })
      } catch (error) {
        // Another concurrent request (e.g. dashboard + projects tab loaded
        // together) may have won the race to create this row first — the
        // unique index on drive_folder_id turns that into a constraint
        // violation instead of a duplicate row. Fall back to reading it.
        if (isUniqueViolation(error)) {
          const winner = await findProjectByDriveFolderId(folder.id)
          if (winner) return winner
        }
        throw error
      }
      if (enabledFromDrive === false) {
        return (
          (await updateProject(created.id, userId, { isActive: false })) ??
          created
        )
      }
      return created
    }),
  )

  // Projects created while Drive was unavailable have no Drive folder yet;
  // keep showing them until they get one (background provisioning) or are
  // deleted, instead of hiding them the moment Drive comes back online.
  const dbOnly = (await listProjectsByUserId(userId)).filter(
    (p) => !p.driveFolderId,
  )

  return [...synced, ...dbOnly].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )
}

/**
 * Entry point for listing a user's projects: scans Drive when available and
 * falls back to the Postgres cache (and, if the scan throws mid-way, so does
 * the site keep working) when Drive is not configured or the user has no
 * Drive folder yet.
 */
export async function listUserProjects(input: {
  userId: string
  userDriveFolderId: string | null
}): Promise<ProjectRecord[]> {
  if (!isGoogleDriveConfigured() || !input.userDriveFolderId) {
    return listProjectsByUserId(input.userId)
  }

  try {
    return await listUserProjectsFromDrive(
      input.userId,
      input.userDriveFolderId,
    )
  } catch (error) {
    console.error(
      "[project-drive] user folder scan failed, falling back to DB cache",
      error,
    )
    return listProjectsByUserId(input.userId)
  }
}

async function requireOptionsFile(
  driveFolderId: string,
  fileName: string,
): Promise<{ fileId: string }> {
  const optionsFolder = await findDriveChildByName(
    driveFolderId,
    OPTIONS_FOLDER_NAME,
    { folderOnly: true },
  )
  if (!optionsFolder) {
    throw new ProjectDriveStateError(
      "Automation is not set up for this project yet.",
    )
  }
  const file = await findDriveChildByName(optionsFolder.id, fileName)
  if (!file) {
    throw new ProjectDriveStateError(
      `Automation file ${fileName} was not found for this project.`,
    )
  }
  return { fileId: file.id }
}

/**
 * Flip the automation switch: rewrites options/folderState.json.
 * Site-initiated disables always use reason "manual"; enabling clears the
 * disabled fields. Unknown fields already present in the file are preserved.
 */
export async function setProjectAutomationEnabled(input: {
  driveFolderId: string
  enabled: boolean
  updatedBy: string
}): Promise<ProjectFolderState> {
  const { fileId } = await requireOptionsFile(
    input.driveFolderId,
    FOLDER_STATE_FILE_NAME,
  )

  const parsed = parseJson(await downloadDriveTextFile(fileId))
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

  await updateDriveTextFile({
    fileId,
    content: JSON.stringify(next, null, 2),
    mimeType: "application/json",
  })

  const state = parseFolderState(next)
  if (!state) {
    throw new ProjectDriveStateError("Failed to update folder state.")
  }
  return state
}

/**
 * Persist edited values back into options/options.json. Only nodes flagged
 * `exposedToSite: true` can be changed, and the value type must match the
 * existing one. The rest of the file is preserved as-is.
 */
export async function updateProjectExposedOptions(input: {
  driveFolderId: string
  changes: { path: string[]; value: ExposedOptionValue }[]
}): Promise<ExposedOption[]> {
  const { fileId } = await requireOptionsFile(
    input.driveFolderId,
    OPTIONS_FILE_NAME,
  )

  const root = parseJson(await downloadDriveTextFile(fileId))
  if (!root || typeof root !== "object") {
    throw new ProjectDriveStateError(
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
      throw new ProjectDriveStateError(
        `Parameter "${change.path.join(".")}" was not found in options.json.`,
      )
    }
    const target = node as Record<string, unknown>
    if (target.exposedToSite !== true) {
      throw new ProjectDriveStateError(
        `Parameter "${change.path.join(".")}" is not editable from the site.`,
      )
    }
    if (typeof target.value !== typeof change.value) {
      throw new ProjectDriveStateError(
        `Parameter "${change.path.join(".")}" has a different value type.`,
      )
    }
    target.value = change.value
  }

  await updateDriveTextFile({
    fileId,
    content: JSON.stringify(root, null, 2),
    mimeType: "application/json",
  })

  return extractExposedOptions(root)
}
