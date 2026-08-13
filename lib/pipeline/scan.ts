import { randomUUID } from "node:crypto"
import { query, withTransaction } from "@/lib/db"
import {
  buildTaskPayload,
  matchesSearchExts,
  readSearchExts,
  type TaskSourceFile,
} from "@/lib/pipeline/build-task"
import { listWatchedProjects } from "@/lib/pipeline/repository"
import { getObjectText, projectOptionsKey } from "@/lib/project-storage"
import { projectPrefix } from "@/lib/storage/keys"

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
 */

/** Сколько событий берём за один проход. Хвост дочитается следующим вызовом. */
const BATCH_LIMIT = 2000

export type SkipReason =
  | "no-options"
  | "invalid-options"
  | "no-main-search"
  | "no-search-exts"
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
  op: "put" | "delete"
  size: string | null
  contentHash: string | null
  payload: { fileId?: string; name?: string; folderPath?: string } | null
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
 * Лежит ли ключ в папке IN проекта.
 *
 * Смотрим на логический путь после префикса проекта: IN на верхнем уровне,
 * вложенность допускаем — граф может искать рекурсивно.
 */
function inFolderPath(
  key: string,
  ownerId: string,
  projectId: string,
): string | null {
  const prefix = projectPrefix(ownerId, projectId)
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  if (!rest.startsWith("IN/")) return null
  const lastSlash = rest.lastIndexOf("/")
  return lastSlash <= 0 ? "IN" : rest.slice(0, lastSlash)
}

/**
 * Собирает задачи по новым файлам в папках IN отслеживаемых проектов.
 *
 * Задачи только складываются в очередь: машинам они на этом шаге не выдаются.
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

  /** options.json читается один раз на проект, а не на каждое событие. */
  const optionsCache = new Map<string, unknown | null>()
  let created = 0

  for (const change of changes.rows) {
    if (change.op !== "put") continue

    const project = watchedById.get(change.projectId)
    if (!project) continue

    const folderPath = inFolderPath(
      change.key,
      project.ownerId,
      project.projectId,
    )
    if (!folderPath) continue

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

    const name =
      change.payload?.name ?? change.key.slice(change.key.lastIndexOf("/") + 1)

    // Тип файла проверяем до сборки очереди: событий на проект приходит пачка,
    // а обходить граф для файла, который всё равно не подойдёт, незачем.
    const exts = readSearchExts(optionsJson)
    if (!exts.ok) {
      noteSkip(project.projectId, project.name, exts.reason)
      continue
    }
    if (!matchesSearchExts(name, exts.searchExts)) {
      noteSkip(project.projectId, project.name, "no-match")
      continue
    }

    const file: TaskSourceFile = {
      fileId: change.payload?.fileId ?? null,
      s3Key: change.key,
      name,
      folderPath,
      sizeBytes: change.size ? Number(change.size) : 0,
      contentHash: change.contentHash,
    }

    const built = buildTaskPayload({
      optionsJson,
      projectId: project.projectId,
      projectName: project.name,
      ownerEmail: project.ownerEmail,
      file,
      collectedAt,
    })

    if (!built.ok) {
      noteSkip(project.projectId, project.name, built.reason)
      continue
    }

    const inserted = await insertTask({
      projectId: project.projectId,
      sourceFileId: file.fileId,
      sourceKey: file.s3Key,
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
 * Ставит задачу в очередь. false — по этому файлу задача уже живая.
 *
 * Дедуп держит уникальный индекс tasks_active_source_idx, а не проверка перед
 * вставкой: повторные put-события по одному файлу приходят пачкой, и проверка
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
