import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import {
  buildTaskPayload,
  matchesSearchExts,
  readSearchExts,
  type FileTypeDictionary,
  type TaskSource,
  type TaskSourceEntry,
} from "@/lib/pipeline/build-task"
import { listWatchedProjects } from "@/lib/pipeline/repository"
import { getObjectText, projectOptionsKey } from "@/lib/project-storage"
import { projectPrefix } from "@/lib/storage/keys"
import { readFileTypeDictionary } from "@/lib/repositories/automation-settings"

/**
 * Сканер конвейера.
 *
 * Watcher'ов и обхода папок нет. Любая запись в хранилище уже журналируется в
 * storage_changes (lib/storage/write-path.ts#journal) — и загрузка из браузера,
 * и notify от машины, и mkdir/rename/delete. Журнал сквозной и упорядочен
 * монотонным seq, поэтому «что нового появилось в IN» — это выборка по
 * seq > last_seq, а не сравнение состояний.
 *
 * Из этого следует важное свойство: ни одно событие не теряется и ни одно не
 * обрабатывается дважды, пока курсор двигается только после успешной обработки
 * пачки.
 *
 * Единица работы — ОДИН элемент верхнего уровня в папке IN: файл или папка.
 * Папка обрабатывается целиком, в один результат, и даёт ровно одну задачу — а не
 * по задаче на каждый файл внутри. Правило готовности папки описано в
 * fs.manager.tauri/ideasAndTest/PIPELINE_BACKEND_REQUESTS.md §2.
 */

/** Сколько событий берём за один проход. Хвост дочитается следующим вызовом. */
const BATCH_LIMIT = 2000

export type SkipReason =
  | "no-options"
  | "invalid-options"
  | "no-main-search"
  | "no-search-type"
  | "unknown-search-type"
  | "no-search-exts"
  | "folder-not-ready"
  | "empty-folder"
  | "no-match"
  | "already-queued"

export type SkippedProject = {
  projectId: string
  projectName: string
  reason: SkipReason
}

export type CollectResult = {
  created: number
  scannedEvents: number
  cursor: number
  skipped: SkippedProject[]
}

type ChangeRow = {
  seq: string
  projectId: string
  key: string
  op: "put" | "delete" | "move"
  size: string | null
  contentHash: string | null
  payload: {
    fileId?: string
    name?: string
    folderPath?: string
    isFolder?: boolean
    from?: { folderPath?: string; name?: string }
    to?: { folderPath?: string; name?: string }
  } | null
}

async function readCursor(): Promise<number> {
  const result = await query<{ lastSeq: string }>(
    `SELECT last_seq::text AS "lastSeq"
       FROM automation_scan_state
      WHERE id = 'singleton'`,
  )
  return result.rows[0] ? Number(result.rows[0].lastSeq) : 0
}

async function writeCursor(seq: number): Promise<void> {
  await query(
    `UPDATE automation_scan_state
        SET last_seq = $1,
            scanned_at = NOW(),
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [seq],
  )
}

/**
 * Папка, которую ещё наполняют.
 *
 * Конвенция десктопа с самого начала (findFilesForSingleFolder.ts,
 * processItem.ts): пока в начале имени стоит `-`, папка не готова. Пользователь
 * докладывает в неё файлы сколько нужно, снял `-` — папка укомплектована.
 */
function isHeldBack(name: string): boolean {
  return name.startsWith("-")
}

/** Элемент верхнего уровня в IN, к которому относится событие. */
type InEntry = {
  /** Имя элемента: `clip.mp4` или `myfolder`. */
  name: string
  /** Логический ключ элемента — он же source_key задачи и ключ дедупа. */
  key: string
  isFolder: boolean
}

/**
 * К какому элементу IN относится ключ события.
 *
 * `IN/clip.mp4`            → файл `clip.mp4`
 * `IN/myfolder/a.mp4`      → папка `myfolder` (не файл внутри!)
 * `IN/myfolder/sub/b.mp4`  → папка `myfolder`
 *
 * Вложенность именно сворачивается к верхнему уровню: файл внутри папки — часть
 * её витка, а не отдельный виток. Иначе одна папка с десятью файлами дала бы
 * десять задач, каждая со своим финальным результатом.
 */
function resolveInEntry(
  key: string,
  ownerId: string,
  projectId: string,
): InEntry | null {
  const prefix = projectPrefix(ownerId, projectId)
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  if (!rest.startsWith("IN/")) return null

  const tail = rest.slice("IN/".length)
  if (!tail) return null

  const slash = tail.indexOf("/")
  const name = slash < 0 ? tail : tail.slice(0, slash)
  if (!name) return null

  return {
    name,
    key: `${prefix}IN/${name}`,
    isFolder: slash >= 0,
  }
}

/**
 * Содержимое папки одним запросом к каталогу, а не листингом R2.
 *
 * Перечисляем в момент, когда папка признана готовой: с этого момента её
 * содержимое заморожено (см. isHeldBack), поэтому манифест не устареет к моменту,
 * когда машина возьмёт задачу. Ровно этого требует DISTRIBUTED_QUEUE_PLAN:
 * оркестратор обходит дерево один раз, машина не переобходит хранилище по сети.
 */
async function readFolderManifest(input: {
  projectId: string
  folderPath: string
}): Promise<TaskSourceEntry[]> {
  const result = await query<{
    id: string
    name: string
    folderPath: string
    s3Key: string | null
    sizeBytes: string
    contentHash: string | null
  }>(
    `SELECT id,
            name,
            folder_path   AS "folderPath",
            s3_key        AS "s3Key",
            size_bytes::text AS "sizeBytes",
            content_hash  AS "contentHash"
       FROM project_files
      WHERE project_id = $1
        AND is_folder = FALSE
        AND deleted_at IS NULL
        AND (folder_path = $2 OR folder_path LIKE $2 || '/%')
      ORDER BY folder_path, name`,
    [input.projectId, input.folderPath],
  )

  return result.rows
    .filter((row) => row.s3Key != null)
    .map((row) => ({
      fileId: row.id,
      s3Key: row.s3Key as string,
      name: row.name,
      folderPath: row.folderPath,
      sizeBytes: Number(row.sizeBytes),
      contentHash: row.contentHash,
    }))
}

/** Кандидат на задачу: элемент IN, к которому свелись события пачки. */
type Candidate = {
  projectId: string
  entry: InEntry
  /** Данные последнего события по этому элементу — для файла это его размер и хеш. */
  fileId: string | null
  sizeBytes: number
  contentHash: string | null
}

/**
 * Собирает задачи по новым элементам в папках IN отслеживаемых проектов.
 *
 * Задачи только складываются в очередь; выдаёт их машинам claimTask
 * (lib/pipeline/queue.ts).
 */
export async function collectTasks(): Promise<CollectResult> {
  const since = await readCursor()
  const watched = await listWatchedProjects()
  const watchedById = new Map(watched.map((p) => [p.projectId, p]))

  const changes = await query<ChangeRow>(
    `SELECT seq::text,
            project_id AS "projectId",
            key,
            op,
            size::text,
            content_hash AS "contentHash",
            payload
       FROM storage_changes
      WHERE seq > $1
      ORDER BY seq ASC
      LIMIT $2`,
    [since, BATCH_LIMIT],
  )

  const scannedEvents = changes.rows.length
  const cursor =
    scannedEvents > 0
      ? Number(changes.rows[changes.rows.length - 1]!.seq)
      : since

  const collectedAt = new Date().toISOString()
  const skipped: SkippedProject[] = []
  const seenSkips = new Set<string>()
  const noteSkip = (
    projectId: string,
    projectName: string,
    reason: SkipReason,
  ) => {
    const dedupKey = `${projectId}:${reason}`
    if (seenSkips.has(dedupKey)) return
    seenSkips.add(dedupKey)
    skipped.push({ projectId, projectName, reason })
  }

  // ── Фаза 1: события → уникальные элементы IN ────────────────────────────────
  //
  // Сворачиваем пачку до кандидатов заранее, а не полагаемся на уникальный
  // индекс при вставке: десять файлов, залитых в одну папку, — это один элемент,
  // и манифест по нему надо строить один раз, а не десять с откатом на конфликте.
  const candidates = new Map<string, Candidate>()

  for (const change of changes.rows) {
    // delete не создаёт работы. А вот move — создаёт: снятие `-` с имени папки
    // приезжает именно как move, и раньше это событие выбрасывалось вместе с
    // остальными, из-за чего готовая папка так и не попадала в очередь.
    if (change.op === "delete") continue

    const project = watchedById.get(change.projectId)
    if (!project) continue

    const entry = resolveInEntry(
      change.key,
      project.ownerId,
      project.projectId,
    )
    if (!entry) continue

    // После move ключ в журнале — старый (переименование каталога физических
    // объектов не двигает), поэтому имя берём из payload.to.
    const renamedTo = change.op === "move" ? change.payload?.to?.name : undefined
    const effective: InEntry = renamedTo
      ? {
          name: renamedTo,
          key: entry.key.slice(0, entry.key.lastIndexOf("/") + 1) + renamedTo,
          // Переименовали саму папку — событие пришло по ней, а не по потомку.
          isFolder: entry.isFolder || change.payload?.isFolder === true,
        }
      : entry

    if (isHeldBack(effective.name)) {
      noteSkip(project.projectId, project.name, "folder-not-ready")
      continue
    }

    const dedupKey = `${project.projectId}:${effective.key}`
    candidates.set(dedupKey, {
      projectId: project.projectId,
      entry: effective,
      fileId: effective.isFolder ? null : (change.payload?.fileId ?? null),
      sizeBytes: change.size ? Number(change.size) : 0,
      contentHash: change.contentHash,
    })
  }

  // ── Фаза 2: кандидаты → задачи ──────────────────────────────────────────────

  /** options.json читается один раз на проект, а не на каждое событие. */
  const optionsCache = new Map<string, unknown | null>()
  /**
   * Общий словарь типов читается лениво и один раз на проход: он нужен только
   * как запасной путь для проектов без снимка fileTypes в графе.
   */
  let sharedFileTypes: FileTypeDictionary | null = null
  const fileTypeFallback = async (): Promise<FileTypeDictionary> => {
    if (sharedFileTypes == null) sharedFileTypes = await readFileTypeDictionary()
    return sharedFileTypes
  }

  let created = 0

  for (const candidate of candidates.values()) {
    const project = watchedById.get(candidate.projectId)
    if (!project) continue

    if (!optionsCache.has(project.projectId)) {
      const raw = await getObjectText(
        projectOptionsKey(project.ownerId, project.projectId),
      )
      if (raw == null) {
        optionsCache.set(project.projectId, null)
      } else {
        try {
          optionsCache.set(project.projectId, JSON.parse(raw))
        } catch {
          optionsCache.set(project.projectId, undefined)
        }
      }
    }

    const optionsJson = optionsCache.get(project.projectId)
    if (optionsJson === null) {
      noteSkip(project.projectId, project.name, "no-options")
      continue
    }
    if (optionsJson === undefined) {
      noteSkip(project.projectId, project.name, "invalid-options")
      continue
    }

    // Типы проверяем до сборки очереди: обходить граф для элемента, который всё
    // равно не подойдёт, незачем.
    const exts = readSearchExts(optionsJson, await fileTypeFallback())
    if (!exts.ok) {
      noteSkip(project.projectId, project.name, exts.reason)
      continue
    }

    const entry = candidate.entry
    let source: TaskSource

    if (entry.isFolder) {
      const folderPath = `IN/${entry.name}`
      const children = await readFolderManifest({
        projectId: project.projectId,
        folderPath,
      })
      // Пустая папка дала бы задачу, которая гарантированно упадёт на машине.
      if (children.length === 0) {
        noteSkip(project.projectId, project.name, "empty-folder")
        continue
      }
      // Расширения проверяем по содержимому: сама папка расширения не имеет, но
      // папка без ни одного подходящего файла — не источник для этого графа.
      if (!children.some((child) => matchesSearchExts(child.name, exts.searchExts))) {
        noteSkip(project.projectId, project.name, "no-match")
        continue
      }
      source = {
        fileId: null,
        s3Key: entry.key,
        name: entry.name,
        folderPath: "IN",
        sizeBytes: 0,
        contentHash: null,
        isFolder: true,
        children,
      }
    } else {
      if (!matchesSearchExts(entry.name, exts.searchExts)) {
        noteSkip(project.projectId, project.name, "no-match")
        continue
      }
      source = {
        fileId: candidate.fileId,
        s3Key: entry.key,
        name: entry.name,
        folderPath: "IN",
        sizeBytes: candidate.sizeBytes,
        contentHash: candidate.contentHash,
      }
    }

    const built = buildTaskPayload({
      optionsJson,
      projectId: project.projectId,
      projectName: project.name,
      ownerEmail: project.ownerEmail,
      source,
      fileTypes: await fileTypeFallback(),
      collectedAt,
    })

    if (!built.ok) {
      noteSkip(project.projectId, project.name, built.reason)
      continue
    }

    const inserted = await insertTask({
      projectId: project.projectId,
      sourceFileId: entry.isFolder ? null : candidate.fileId,
      sourceKey: entry.key,
      payload: built.payload,
    })
    if (inserted) created += 1
    else noteSkip(project.projectId, project.name, "already-queued")
  }

  // Курсор двигаем последним: упади что-то выше — пачка перечитается,
  // а дубли отсечёт уникальный индекс по (project_id, source_key).
  if (cursor !== since) await writeCursor(cursor)

  return { created, scannedEvents, cursor, skipped }
}

/**
 * Ставит задачу в очередь. false — по этому элементу задача уже живая.
 *
 * Дедуп держит уникальный индекс tasks_active_source_idx, а не проверка перед
 * вставкой: повторные события по одному элементу приходят пачкой, и проверка
 * «нет ли уже» между чтением и вставкой ничего не гарантирует.
 */
async function insertTask(input: {
  projectId: string
  sourceFileId: string | null
  sourceKey: string
  payload: unknown
}): Promise<boolean> {
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO tasks (id, project_id, source_file_id, source_key, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        randomUUID(),
        input.projectId,
        input.sourceFileId,
        input.sourceKey,
        JSON.stringify(input.payload),
      ],
    )
    return result.rowCount === 1
  })
}
