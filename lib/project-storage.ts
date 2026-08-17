import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3"
import type { ProjectFileRecord } from "@/lib/domain-types"
import { listAllProjectFiles } from "@/lib/repositories/project-files"
import { buildProjectObjectKey, getS3Bucket, userMetaObjectKey } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import {
  DESCRIPTION_FILE_NAME,
  FOLDER_STATE_FILE_NAME,
  isServiceCatalogRow,
  OPTIONS_FILE_NAME,
  OPTIONS_FOLDER_NAME,
} from "@/lib/storage/keys"

/**
 * R2/S3 layout for a project (replaces the Google Drive tree):
 *
 *   projects/{userId}/{projectId}/project-meta.json
 *   projects/{userId}/{projectId}/options/folderState.json
 *   projects/{userId}/{projectId}/options/options.json
 *   projects/{userId}/{projectId}/{folderPath}/{uuid}-{name}   — user files
 *
 * Структура папок для кабинета живёт в Postgres `project_files` — вместе со
 * служебной папкой `options`: она такая же папка каталога, как любая другая, и
 * показывается в дереве наравне с ними. Строки сайдкарам создаёт
 * `writeSidecarSync` (lib/storage/write-path.ts), потому что сами объекты
 * пишутся по фиксированному ключу, минуя presign/notify.
 */

/**
 * Имена служебных файлов и папки лежат в lib/storage/keys.ts: их читает путь
 * записи, а импорт оттуда в эту сторону замкнул бы цикл. Здесь только
 * реэкспорт — чтобы существующие импорты из `@/lib/project-storage` работали.
 *
 * `description.md` — развёрнутое описание проекта в markdown: картинки, схемы,
 * таблицы. Отдельный файл, а не поле в options.json: options.json принадлежит
 * редактору нод, его формат задаёт десктопное приложение. Короткая подпись
 * остаётся в projects.description — она нужна на карточке в списке, а ходить за
 * ней в объектное хранилище на каждый рендер списка нельзя.
 */
export {
  DESCRIPTION_FILE_NAME,
  FOLDER_STATE_FILE_NAME,
  OPTIONS_FILE_NAME,
  OPTIONS_FOLDER_NAME,
}

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
  /** Кто принёс файл; null — атрибуции нет (загрузка до её появления). */
  uploadedByName?: string | null
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
  /** Тип контрола из графа (`slider`, `checkbox`, `ddm`, …) — им UI выбирает, чем рисовать. */
  controlType: string | null
  /**
   * Границы для числовых контролов, как их задал автор графа.
   * Лежат в `controlProps` рядом со значением, поэтому достаются бесплатно —
   * отдельного канала для ограничений не нужно.
   */
  minValue: number | null
  maxValue: number | null
  step: number | null
  /** Варианты для `ddm` / `autocomplete`. */
  options: string[] | null
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

function optionalString(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw : null
}

function optionalNumber(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null
}

function optionalStringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const items = raw.filter((item): item is string => typeof item === "string")
  return items.length > 0 ? items : null
}

/**
 * Ищет в графе свойства, помеченные `exposedToSite`.
 *
 * Форма свойства задана в программе (`PropertyBase` в
 * fs.manager.tauri/src/NODE_WIN/definitions/types.ts): флаг стоит на самом
 * свойстве, а значение и его ограничения — уровнем ниже, в `controlProps`.
 *
 *     { id, controlType: "slider", exposedToSite: true,
 *       controlProps: { label, value: 30, minValue: 5, maxValue: 120, step: 1 } }
 *
 * Раньше здесь читалось `obj.value` — на том же объекте, где флаг. Такого поля
 * у свойства нет, поэтому список выходил всегда пустым, а вкладка настроек
 * выглядела «просто ещё не заполненной». Плоский `value` всё же оставлен как
 * запасной путь: им пользуются свойства попроще и старые файлы.
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
    const controlProps =
      obj.controlProps && typeof obj.controlProps === "object" && !Array.isArray(obj.controlProps)
        ? (obj.controlProps as Record<string, unknown>)
        : null

    // Путь ведёт туда, где реально лежит value: запись потом идёт по нему же,
    // иначе рядом с controlProps появилось бы второе поле value, которого
    // программа не читает.
    const valueHost = controlProps && "value" in controlProps ? controlProps : obj
    const valuePath = valueHost === obj ? path : [...path, "controlProps"]

    const value = valueHost.value
    const type = typeof value
    if (type === "boolean" || type === "number" || type === "string") {
      const key = typeof obj.id === "string" && obj.id.trim()
        ? obj.id
        : (path[path.length - 1] ?? "option")
      out.push({
        path: valuePath,
        key,
        label:
          optionalString(valueHost.label) ??
          optionalString(obj.label) ??
          optionalString(obj.title) ??
          key,
        description:
          optionalString(valueHost.tooltip) ??
          optionalString(obj.description) ??
          optionalString(valueHost.description),
        type,
        value: value as ExposedOptionValue,
        controlType: optionalString(obj.controlType),
        minValue: optionalNumber(valueHost.minValue),
        maxValue: optionalNumber(valueHost.maxValue),
        step: optionalNumber(valueHost.step),
        options: optionalStringList(valueHost.options),
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

export type ObjectTextWithMeta = {
  body: string
  etag: string | null
  sizeBytes: number
  lastModified: string | null
}

/**
 * Читает текст объекта вместе с его версией.
 *
 * Версия нужна на чтении сайдкара: клиент сравнивает облачную копию с локальной,
 * а `etag` возвращает обратно в `ifMatch` при записи — иначе перезапись затрёт
 * правку, случившуюся между чтением и записью, и узнать об этом будет нечем.
 */
export async function getObjectTextWithMeta(
  key: string,
): Promise<ObjectTextWithMeta | null> {
  if (!isS3Configured()) return null
  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    const body = response.Body
    if (!body) return null
    return {
      body: await body.transformToString(),
      etag: response.ETag?.replace(/"/g, "") ?? null,
      sizeBytes: Number(response.ContentLength ?? 0),
      lastModified: response.LastModified?.toISOString() ?? null,
    }
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

export async function getObjectText(key: string): Promise<string | null> {
  const object = await getObjectTextWithMeta(key)
  return object?.body ?? null
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

/**
 * Манифест проекта скрыт всегда: его пишет сайт, редактировать его человеку
 * нечем, и в списке файлов он выглядел бы мусором.
 *
 * Служебная папка `options` скрывается не здесь, а по представлению —
 * `isServiceCatalogRow` плюс флаг `includeServiceFiles`.
 */
function isHiddenName(name: string): boolean {
  return name.toLowerCase() === PROJECT_META_FILE_NAME
}

/**
 * Отсекает служебную папку и её содержимое из плоского списка строк каталога.
 *
 * Нужна везде, где строки уходят пользователю списком, а не деревом: с
 * появлением строк у сайдкаров (`writeSidecarSync`) `options/options.json` и
 * `options/__stat/*.jsonl` иначе попадают в материалы проекта наравне с его
 * файлами. Админский «Конвейер» этой функцией не пользуется — он показывает всё.
 */
export function withoutServiceRows<
  T extends { folderPath: string; name: string; isFolder: boolean },
>(rows: T[]): T[] {
  return rows.filter((row) => !isServiceCatalogRow(row))
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
    uploadedByName: row.uploadedByName ?? null,
  }
}

function buildTree(
  rows: ProjectFileRecord[],
  view: { includeServiceFiles: boolean },
): ProjectStorageFile[] {
  const visible = rows.filter(
    (row) =>
      !isHiddenName(row.name) &&
      (view.includeServiceFiles || !isServiceCatalogRow(row)),
  )
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
 *
 * `includeServiceFiles` включает в дерево служебную папку `options`. По
 * умолчанию она скрыта: в кабинете пользователь работает с материалами проекта,
 * а настройки автоматизации у него на отдельной вкладке. Включает флаг только
 * админский «Конвейер» — он работает именно со служебными файлами.
 *
 * Сама папка при этом приезжает из того же `project_files`, что и всё остальное:
 * отдельного листинга бакета для неё больше нет. Раньше он был нужен, потому что
 * сайдкарам не создавали строк, и из-за него в «Конвейере» показывались
 * физические имена (`{uuid}-folderState.json`) и мусор от прошлых заливок.
 */
export async function loadProjectStorageState(
  userId: string,
  projectId: string,
  view?: { includeServiceFiles?: boolean },
): Promise<ProjectStorageState> {
  const available = isS3Configured()
  const rows = await listAllProjectFiles(projectId)
  const files = buildTree(rows, {
    includeServiceFiles: view?.includeServiceFiles === true,
  })

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

/** Спускается по пути внутрь разобранного JSON. `null`, если путь никуда не ведёт. */
function resolvePath(root: unknown, path: string[]): unknown {
  let node: unknown = root
  for (const segment of path) {
    if (!node || typeof node !== "object") return null
    node = Array.isArray(node)
      ? node[Number.parseInt(segment, 10)]
      : (node as Record<string, unknown>)[segment]
  }
  return node && typeof node === "object" && !Array.isArray(node) ? node : null
}

/**
 * Зажимает число в границы `minValue`/`maxValue` и по возможности выравнивает по
 * `step`. Отсутствующая граница ничего не ограничивает.
 *
 * Зажимаем, а не отклоняем: значение вне диапазона — это почти всегда устаревшая
 * страница, а не злой умысел, и отказ здесь выглядел бы поломкой ползунка.
 */
function clampToBounds(value: number, host: Record<string, unknown>): number {
  const min = typeof host.minValue === "number" ? host.minValue : null
  const max = typeof host.maxValue === "number" ? host.maxValue : null
  const step = typeof host.step === "number" && host.step > 0 ? host.step : null

  let next = value
  if (min != null && next < min) next = min
  if (max != null && next > max) next = max
  if (step != null && min != null) {
    next = min + Math.round((next - min) / step) * step
    // Выравнивание по шагу может вытолкнуть за верхнюю границу — возвращаем.
    if (max != null && next > max) next = max
  }
  // Шаг вроде 0.1 даёт хвост в двоичной дроби; округляем до разумной точности.
  return Number.isInteger(next) ? next : Number(next.toFixed(6))
}

/**
 * Применяет правки к разобранному графу — на месте, без обращений к хранилищу.
 *
 * Отдельно от `updateProjectExposedOptions`, потому что вся содержательная часть
 * (разрешение, тип, границы) здесь, а без R2 её иначе не проверить.
 */
export function applyExposedOptionChanges(
  root: unknown,
  changes: { path: string[]; value: ExposedOptionValue }[],
): void {
  for (const change of changes) {
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

    // Путь из extractExposedOptions ведёт туда, где лежит value — обычно это
    // controlProps. Флаг же стоит на самом свойстве, то есть на родителе,
    // поэтому разрешение проверяем там.
    const isControlProps =
      change.path[change.path.length - 1] === "controlProps"
    const owner = isControlProps
      ? (resolvePath(root, change.path.slice(0, -1)) as Record<string, unknown> | null)
      : target

    if (!owner || owner.exposedToSite !== true) {
      throw new ProjectStorageError(
        `Parameter "${change.path.join(".")}" is not editable from the site.`,
      )
    }
    if (typeof target.value !== typeof change.value) {
      throw new ProjectStorageError(
        `Parameter "${change.path.join(".")}" has a different value type.`,
      )
    }

    // Границы задал автор графа и они лежат здесь же, рядом со значением.
    // Проверяем их и на сервере: контрол в браузере зажимает ввод, но границы
    // могли поменяться в программе уже после того, как страница загрузилась.
    target.value =
      typeof change.value === "number"
        ? clampToBounds(change.value, target)
        : change.value
  }
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

  applyExposedOptionChanges(root, input.changes)

  // ⬜ Запись безусловная: между чтением и записью программа могла сохранить
  // граф целиком по Ctrl+S, и тогда эта правка затрёт её изменения (или её
  // сохранение — эту правку). Нужна условная запись по ETag — см.
  // docs/PROJECT_OPTIONS_PANEL.md §4.
  await putObjectText(key, JSON.stringify(root, null, 2))
  return extractExposedOptions(root)
}
