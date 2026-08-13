import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { listAllProjectFiles } from "@/lib/repositories/project-files"
import {
  buildProjectObjectKey,
  getS3Bucket,
  projectObjectPrefix,
  userMetaObjectKey,
} from "@/lib/s3-config"
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
/**
 * Развёрнутое описание проекта в markdown: картинки, схемы, таблицы.
 *
 * Отдельный файл, а не поле в options.json: options.json принадлежит редактору
 * нод, его формат задаёт десктопное приложение. Короткая подпись остаётся в
 * projects.description — она нужна на карточке в списке, а ходить за ней в
 * объектное хранилище на каждый рендер списка нельзя.
 */
export const DESCRIPTION_FILE_NAME = "description.md"

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

export function projectDescriptionKey(
  userId: string,
  projectId: string,
): string {
  return buildProjectObjectKey(
    userId,
    projectId,
    `${OPTIONS_FOLDER_NAME}/${DESCRIPTION_FILE_NAME}`,
  )
}

/**
 * Читает описание проекта. null — файла ещё нет, это нормальное состояние:
 * описание появляется, когда его напишут.
 */
export async function readProjectDescriptionMd(
  userId: string,
  projectId: string,
): Promise<string | null> {
  return getObjectText(projectDescriptionKey(userId, projectId))
}

export async function writeProjectDescriptionMd(input: {
  userId: string
  projectId: string
  body: string
}): Promise<void> {
  await putObjectText(
    projectDescriptionKey(input.userId, input.projectId),
    input.body,
    "text/markdown; charset=utf-8",
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
  isArchived?: boolean
  createdAt?: string
  updatedAt?: string
}): Promise<void> {
  const now = new Date().toISOString()
  const payload = {
    schema: 1,
    projectId: input.projectId,
    name: input.name,
    description: input.description,
    ownerId: input.userId,
    ownerEmail: input.ownerEmail,
    isArchived: input.isArchived ?? false,
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  }
  await putObjectText(
    projectMetaKey(input.userId, input.projectId),
    JSON.stringify(payload, null, 2),
  )
}

export async function writeUserMeta(input: {
  userId: string
  email: string
  createdAt?: string
}): Promise<void> {
  const payload = {
    schema: 1,
    userId: input.userId,
    email: input.email,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
  await putObjectText(
    userMetaObjectKey(input.userId),
    JSON.stringify(payload, null, 2),
  )
}

export async function syncUserMeta(input: {
  userId: string
  email: string
  createdAt?: string
}): Promise<void> {
  try {
    await writeUserMeta(input)
  } catch (error) {
    console.error("[storage] failed to write user-meta.json", error)
  }
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
 * Содержимое служебной папки options как узел дерева.
 *
 * Строится листингом R2, а не выборкой из project_files: сайдкаров там нет и не
 * будет. Их пишут напрямую в объектное хранилище, а reindex пропускает этот
 * префикс намеренно (см. lib/storage/write-path.ts), чтобы служебные файлы не
 * появлялись в кабинете пользователя как обычные.
 *
 * Листинг, а не HEAD по известным именам: кроме folderState.json, options.json и
 * description.md десктопное приложение кладёт туда и другие сайдкары
 * (postSources.json, tgSearch.json), и админ должен видеть всё, что есть.
 */
export async function listProjectServiceFiles(
  userId: string,
  projectId: string,
): Promise<ProjectStorageFile | null> {
  if (!isS3Configured()) return null

  const prefix = `${projectObjectPrefix(userId, projectId)}${OPTIONS_FOLDER_NAME}/`
  const children: ProjectStorageFile[] = []

  let token: string | undefined
  do {
    const page = await getS3Client().send(
      new ListObjectsV2Command({
        Bucket: getS3Bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue
      const name = obj.Key.slice(obj.Key.lastIndexOf("/") + 1)
      if (!name) continue
      const modified = obj.LastModified?.toISOString() ?? null
      children.push({
        // Идентичности в БД у этих файлов нет, поэтому id — сам ключ.
        // Он стабилен и уникален, а больше от него в дереве ничего не требуется.
        id: obj.Key,
        name,
        mimeType: name.endsWith(".json")
          ? "application/json"
          : name.endsWith(".md")
            ? "text/markdown"
            : "application/octet-stream",
        isFolder: false,
        sizeBytes: Number(obj.Size ?? 0),
        modifiedAt: modified,
        createdAt: modified,
        s3Key: obj.Key,
        folderPath: OPTIONS_FOLDER_NAME,
      })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  if (children.length === 0) return null

  children.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  )

  return {
    id: `${prefix}`,
    name: OPTIONS_FOLDER_NAME,
    mimeType: "application/vnd.folder",
    isFolder: true,
    sizeBytes: null,
    modifiedAt: null,
    createdAt: null,
    s3Key: null,
    folderPath: "",
    children,
  }
}

/**
 * Cabinet view: nested file tree from Postgres + automation JSON from R2.
 *
 * `includeServiceFiles` включает в дерево служебную папку options — так админский
 * «Конвейер» видит проект целиком, тогда как в кабинете пользователя эта папка
 * скрыта (buildTree отсекает её через isHiddenName).
 */
export async function loadProjectStorageState(
  userId: string,
  projectId: string,
  view?: { includeServiceFiles?: boolean },
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

  const [stateRaw, optionsRaw, serviceFolder] = await Promise.all([
    getObjectText(projectFolderStateKey(userId, projectId)),
    getObjectText(projectOptionsKey(userId, projectId)),
    view?.includeServiceFiles
      ? listProjectServiceFiles(userId, projectId)
      : Promise.resolve<ProjectStorageFile | null>(null),
  ])

  // Служебная папка идёт первой: она про настройку проекта, а не про его данные.
  if (serviceFolder) files.unshift(serviceFolder)

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

/**
 * Пишет options/folderState.json. Файла может не быть: десктоп намеренно не
 * создаёт options/ у нетронутых проектов (см. docs/FOLDER_STATE_SSOT_PLAN.md),
 * поэтому первое переключение тумблера его создаёт, а не падает. Готовность
 * проекта к обработке это НЕ означает — её определяет наличие options.json
 * (см. optionsFileExists в ProjectStorageState).
 *
 * Не вызывать напрямую для смены паузы: тумблер живёт в двух хранилищах, и
 * порядок записи задаёт lib/project-automation.ts#setProjectPaused.
 */
export async function setProjectAutomationEnabled(input: {
  userId: string
  projectId: string
  enabled: boolean
  updatedBy: string
}): Promise<ProjectFolderState> {
  const key = projectFolderStateKey(input.userId, input.projectId)
  const raw = await getObjectText(key)
  const parsed = raw == null ? null : parseJson(raw)
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
