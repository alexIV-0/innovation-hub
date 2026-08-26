/**
 * Скачивание папки проекта архивом — расчёт состава и разбиение на части.
 *
 * Почему части, а не один файл: папка проекта — это исходники и рендеры, её
 * обычный размер измеряется десятками гигабайт. Один такой архив не примет
 * файловая система с FAT32 на флешке, его тяжело докачивать после обрыва и
 * невозможно начать распаковывать, пока не приедет последний байт. Поэтому
 * файлы раскладываются по независимым архивам не больше `partSize`
 * (по умолчанию 2 ГБ) — так же, как это делает Google Drive.
 *
 * Части **не** тома одного архива: каждый `.zip` открывается сам по себе, без
 * остальных. Единственное исключение — файл, который сам больше лимита: он
 * уезжает в свою часть целиком (`oversize`), потому что резать файл посередине
 * означало бы ровно тот многотомный архив, которого мы избегаем.
 *
 * Плана в базе нет: состав частей выводится из каталога заново на каждый
 * запрос и сверяется с `version` — отпечатком состава. Пока папка не менялась,
 * часть №2 у запроса плана и у запроса скачивания одна и та же; изменилась —
 * клиент получает 409 и перечитывает план, а не молча скачивает архив с чужой
 * нумерацией. Ни таблицы, ни уборки просроченных планов при этом не нужно.
 */

import { createHash } from "node:crypto"
import { query } from "@/lib/db"
import { isServiceCatalogRow } from "@/lib/storage/keys"
import {
  appendZipEntry,
  EMPTY_ZIP_SIZE,
  planZipLayout,
  zipTotalSize,
  type ZipLayout,
  type ZipStreamEntry,
} from "@/lib/storage/zip-stream"

const GIB = 1024 * 1024 * 1024

/** Столько отдаёт `partSize` по умолчанию. */
export const DEFAULT_PART_BYTES = 2 * GIB
/** Меньше 64 МБ смысла нет: частей станет больше, чем полезной работы. */
export const MIN_PART_BYTES = 64 * 1024 * 1024
/** Больше 2 ГБ не даём: это тот предел, ради которого всё и разбивается. */
export const MAX_PART_BYTES = 2 * GIB

/**
 * Предел на число записей в плане. Упирается не в ZIP (там ZIP64), а в память
 * приложения: раскладка держится в процессе целиком на каждый запрос.
 */
export const MAX_ARCHIVE_ENTRIES = 100_000

export class ArchiveError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ArchiveError"
    this.status = status
  }
}

export type ArchivePart = {
  /** Номер части, с единицы. */
  index: number
  /** Имя файла архива: `Папка-part2of5.zip`. */
  name: string
  fileCount: number
  /** Сумма размеров вложенных файлов. */
  contentBytes: number
  /** Размер самого архива — он же `Content-Length` при скачивании. */
  archiveBytes: number
  /** В части один файл, и он сам больше лимита. */
  oversize: boolean
  entries: ZipStreamEntry[]
}

export type ArchivePlan = {
  /** Имя корня архива — оно же папка первого уровня внутри `.zip`. */
  baseName: string
  fileCount: number
  totalBytes: number
  partSize: number
  /** Отпечаток состава: тот же состав — тот же план. */
  version: string
  parts: ArchivePart[]
}

/**
 * Имя для файла архива. Каталог уже не пропускает `/`, `\` и управляющие
 * символы в имени, но корнем может быть имя проекта — оно таких проверок не
 * проходило.
 */
export function sanitizeArchiveBaseName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 100)
  return cleaned || "archive"
}

function normalizeFolderPath(value: string): string {
  return value.replace(/^\/+|\/+$/g, "")
}

type CatalogRow = {
  id: string
  folderPath: string
  name: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number
  originMtime: number | null
  updatedAt: Date
}

async function loadSubtree(
  projectId: string,
  rootFolderPath: string,
): Promise<CatalogRow[]> {
  const result = await query<CatalogRow>(
    /*
     * `left(...)` вместо `LIKE $2 || '/%'`: в имени папки законны `%` и `_`,
     * а для LIKE это шаблон. Папка «50% off» иначе затянула бы в архив
     * половину проекта.
     */
    `SELECT id,
            folder_path AS "folderPath",
            name,
            is_folder AS "isFolder",
            s3_key AS "s3Key",
            size_bytes::float8 AS "sizeBytes",
            origin_mtime AS "originMtime",
            updated_at AS "updatedAt"
       FROM project_files
      WHERE project_id = $1
        AND deleted_at IS NULL
        AND ($2 = ''
             OR folder_path = $2
             OR left(folder_path, length($2) + 1) = $2 || '/')`,
    [projectId, rootFolderPath],
  )
  return result.rows
}

function entryModifiedAt(row: CatalogRow): Date {
  if (row.originMtime && row.originMtime > 0) {
    return new Date(row.originMtime * 1000)
  }
  return new Date(row.updatedAt)
}

/**
 * Состав архива: файлы поддерева плюс папки без файлов.
 *
 * Папка, внутри которой на любой глубине нет ни одного файла, попадает в архив
 * отдельной записью — иначе она исчезает: распаковщик создаёт каталоги по путям
 * файлов, а пустой каталог в путях не упоминается. Для проекта это
 * существенно — структура папок и есть договор с программой обработки.
 *
 * Правило именно такое, а не «только самые глубокие»: запись стоит сотню байт,
 * а «каждая папка без файлов видна в описи» проверяется одним взглядом.
 */
export async function loadArchiveEntries(input: {
  projectId: string
  rootFolderPath: string
  baseName: string
}): Promise<{ entries: ZipStreamEntry[]; fileCount: number; totalBytes: number }> {
  const root = normalizeFolderPath(input.rootFolderPath)
  const rows = (await loadSubtree(input.projectId, root)).filter(
    (row) => !isServiceCatalogRow(row),
  )

  const relative = (folderPath: string): string => {
    const normalized = normalizeFolderPath(folderPath)
    if (!root) return normalized
    if (normalized === root) return ""
    return normalized.slice(root.length + 1)
  }

  // Папки, внутри которых (на любой глубине) есть хотя бы один файл.
  const populated = new Set<string>()
  for (const row of rows) {
    if (row.isFolder) continue
    const segments = relative(row.folderPath).split("/").filter(Boolean)
    for (let i = 0; i < segments.length; i += 1) {
      populated.add(segments.slice(0, i + 1).join("/"))
    }
  }

  const entries: ZipStreamEntry[] = []
  let fileCount = 0
  let totalBytes = 0

  for (const row of rows) {
    const dir = relative(row.folderPath)
    const path = dir ? `${dir}/${row.name}` : row.name

    if (row.isFolder) {
      if (populated.has(path)) continue
      entries.push({
        path: `${input.baseName}/${path}/`,
        size: 0,
        s3Key: null,
        modified: entryModifiedAt(row),
        isDir: true,
      })
      continue
    }
    if (!row.s3Key) continue

    const size = Math.max(0, Math.round(row.sizeBytes))
    entries.push({
      path: `${input.baseName}/${path}`,
      size,
      s3Key: row.s3Key,
      modified: entryModifiedAt(row),
      isDir: false,
    })
    fileCount += 1
    totalBytes += size
  }

  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new ArchiveError(
      `Folder holds more than ${MAX_ARCHIVE_ENTRIES} items — download it in parts by subfolder.`,
      413,
    )
  }

  /*
   * Порядок задаёт нумерацию частей, поэтому сортировка своя, а не из ORDER BY:
   * сравнение строк в JS не зависит от collation базы, и план не поедет от
   * смены локали сервера.
   */
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return { entries, fileCount, totalBytes }
}

/**
 * Корень архива: папка каталога или весь проект.
 *
 * Клиент присылает либо `folderId` (строка дерева — так приходит из
 * контекстного меню), либо `folderPath` (текущая папка рабочей области;
 * пустая строка — корень проекта). Оба варианта нужны: у корня проекта строки
 * в каталоге нет, а у папки из меню есть только id.
 */
export async function resolveArchiveRoot(input: {
  projectId: string
  projectName: string
  folderId?: string | null
  folderPath?: string | null
}): Promise<{ rootFolderPath: string; baseName: string }> {
  if (input.folderId) {
    const result = await query<{
      folderPath: string
      name: string
      isFolder: boolean
    }>(
      `SELECT folder_path AS "folderPath", name, is_folder AS "isFolder"
         FROM project_files
        WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`,
      [input.folderId, input.projectId],
    )
    const row = result.rows[0]
    if (!row) throw new ArchiveError("Folder not found.", 404)
    if (!row.isFolder) {
      throw new ArchiveError("Only folders can be archived.", 400)
    }
    const parent = normalizeFolderPath(row.folderPath)
    return {
      rootFolderPath: parent ? `${parent}/${row.name}` : row.name,
      baseName: row.name,
    }
  }

  const path = normalizeFolderPath(input.folderPath ?? "")
  if (!path) {
    return { rootFolderPath: "", baseName: input.projectName }
  }

  const segments = path.split("/")
  const name = segments[segments.length - 1]!
  const parent = segments.slice(0, -1).join("/")
  const exists = await query<{ one: number }>(
    `SELECT 1 AS one
       FROM project_files
      WHERE project_id = $1
        AND folder_path = $2
        AND name = $3
        AND is_folder
        AND deleted_at IS NULL`,
    [input.projectId, parent, name],
  )
  if (!exists.rows[0]) throw new ArchiveError("Folder not found.", 404)
  return { rootFolderPath: path, baseName: name }
}

/** Отпечаток состава: файл, его размер и порядок. */
function planVersion(entries: ZipStreamEntry[]): string {
  const hash = createHash("sha1")
  for (const entry of entries) {
    hash.update(`${entry.path}:${entry.size}\n`)
  }
  return hash.digest("hex").slice(0, 16)
}

function partName(baseName: string, index: number, total: number): string {
  return total === 1
    ? `${baseName}.zip`
    : `${baseName}-part${index}of${total}.zip`
}

export function clampPartSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_PART_BYTES
  return Math.min(MAX_PART_BYTES, Math.max(MIN_PART_BYTES, Math.floor(value)))
}

/**
 * Раскладывает записи по частям: жадно, в порядке путей, пока очередная запись
 * умещается в лимит вместе с описью и хвостом архива.
 *
 * Считает не сумму файлов, а размер готового `.zip`: заголовки, дескрипторы и
 * опись — это десятки байт на запись, и на десятках тысяч мелких файлов они
 * складываются в мегабайты. Часть, которая обещала 2 ГБ и выдала 2 ГБ с
 * лишним, — это ровно то, чего просили избежать.
 */
export function splitArchiveEntries(input: {
  entries: ZipStreamEntry[]
  partSize: number
}): { parts: Omit<ArchivePart, "index" | "name">[] } {
  const parts: Omit<ArchivePart, "index" | "name">[] = []

  let current: ZipStreamEntry[] = []
  let acc = EMPTY_ZIP_SIZE
  let contentBytes = 0
  let fileCount = 0

  const flush = () => {
    if (current.length === 0) return
    parts.push({
      entries: current,
      fileCount,
      contentBytes,
      archiveBytes: zipTotalSize(acc),
      oversize: zipTotalSize(acc) > input.partSize,
    })
    current = []
    acc = EMPTY_ZIP_SIZE
    contentBytes = 0
    fileCount = 0
  }

  for (const entry of input.entries) {
    let step = appendZipEntry(acc, entry)
    if (current.length > 0 && zipTotalSize(step.acc) > input.partSize) {
      flush()
      // Накопитель сброшен — запись открывает новую часть с нулевого смещения.
      step = appendZipEntry(acc, entry)
    }
    acc = step.acc
    current.push(entry)
    contentBytes += entry.size
    if (!entry.isDir) fileCount += 1
  }
  flush()

  return { parts }
}

export async function buildArchivePlan(input: {
  projectId: string
  rootFolderPath: string
  baseName: string
  partSize?: number
}): Promise<ArchivePlan> {
  const baseName = sanitizeArchiveBaseName(input.baseName)
  const partSize = clampPartSize(input.partSize)
  const { entries, fileCount, totalBytes } = await loadArchiveEntries({
    projectId: input.projectId,
    rootFolderPath: input.rootFolderPath,
    baseName,
  })

  const { parts } = splitArchiveEntries({ entries, partSize })

  return {
    baseName,
    fileCount,
    totalBytes,
    partSize,
    version: planVersion(entries),
    parts: parts.map((part, i) => ({
      ...part,
      index: i + 1,
      name: partName(baseName, i + 1, parts.length),
    })),
  }
}

/** Часть плана без состава — то, что уходит в интерфейс. */
export function serializeArchivePart(part: ArchivePart) {
  return {
    index: part.index,
    name: part.name,
    fileCount: part.fileCount,
    contentBytes: part.contentBytes,
    archiveBytes: part.archiveBytes,
    oversize: part.oversize,
  }
}

export function serializeArchivePlan(plan: ArchivePlan) {
  return {
    baseName: plan.baseName,
    fileCount: plan.fileCount,
    totalBytes: plan.totalBytes,
    partSize: plan.partSize,
    version: plan.version,
    parts: plan.parts.map(serializeArchivePart),
  }
}

/** Раскладка одной части — с ней уже можно писать поток. */
export function layoutForPart(part: ArchivePart): ZipLayout {
  return planZipLayout(part.entries)
}
