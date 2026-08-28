import { ListObjectsV2Command } from "@aws-sdk/client-s3"
import { query } from "@/lib/db"
import { getObjectTextWithMeta } from "@/lib/project-storage"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { projectPrefix } from "@/lib/storage/keys"

/**
 * Импорт архива обработок из R2 в `processing_stats` (docs/PIPELINE.md §14).
 *
 * Базовый путь — чтение файлов, а не пуш: машины уже пишут JSONL в папку
 * проекта, схема v1 заморожена, и эти же файлы остаются резервной копией у
 * пользователя. Сайт в `_stats` не пишет никогда: канал односторонний.
 *
 * Свойство, на которое всё опирается: строки иммутабельны, ключ дедупа —
 * `item_id`, вставка `ON CONFLICT DO NOTHING`. Поэтому файл можно перечитывать
 * сколько угодно раз и с любого места, дублей не будет.
 */

/** Сколько файлов читаем за один проход. Бюджет прохода, не лимит данных. */
const MAX_FILES_PER_RUN = 500
/** Размер пачки вставки. */
const INSERT_BATCH = 200

export type ImportArchiveResult = {
  projectsScanned: number
  filesSeen: number
  filesRead: number
  linesRead: number
  rowsInserted: number
  duplicates: number
  malformed: number
  partial: number
  filesSkipped: number
  errors: number
}

type StatsRowInput = {
  itemId: string
  projectId: string
  schemaVersion: number
  status: string
  projectName: string
  mainFolder: string
  curItem: string
  inType: string | null
  outType: string | null
  registeredAt: string | null
  startedAt: string | null
  endedAt: string | null
  outSec: number | null
  /** Хронометраж исходника — поле схемы v2. У строк v1 отсутствует. */
  srcSec: number | null
  renderSec: number | null
  outPaths: string
  totalCost: number | null
  machine: string | null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value)
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? Math.round(parsed) : null
  }
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Границы колонок. Значение вне них — брак строки, а не повод ронять пачку. */
const INT4_MAX = 2_147_483_647
const COST_MAX = 999_999.999999

/** `INTEGER` в схеме: за границей int4 вставка отменила бы всю транзакцию. */
function asInt4(value: unknown): number | null {
  const parsed = asInt(value)
  if (parsed === null) return null
  return Math.abs(parsed) <= INT4_MAX ? parsed : null
}

/** `NUMERIC(12,6)`: и точность, и порядок ограничены самой колонкой. */
function asCost(value: unknown): number | null {
  const parsed = asNumber(value)
  if (parsed === null) return null
  if (Math.abs(parsed) > COST_MAX) return null
  return Math.round(parsed * 1e6) / 1e6
}

/**
 * Время из строки ISO или из числа. Числа встречаются и в секундах, и в
 * миллисекундах, поэтому различаем по величине: 1e12 — это 2001 год в
 * миллисекундах и 33-й век в секундах, спутать нечего.
 */
function asTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const raw = asString(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * Имя машины из имени объекта: `[uuid-]$YYYY.$MM.$machine.jsonl`. Машина в
 * имени — не украшение: общий файл на месяц две машины затирали бы молча, а по
 * этому суффиксу видно, чья строка.
 */
export function machineFromStatsKey(key: string): string | null {
  const base = key.slice(key.lastIndexOf("/") + 1).replace(/\.jsonl$/i, "")
  const match = base.match(/(\d{4})\.(\d{2})\.(.+)$/)
  return match?.[3] ?? null
}

/**
 * Разбор строки схемы v1. Имена полей берутся по факту файла, а не по §14:
 * машина пишет `out` и `project`, тогда как в документе они названы `outPaths`
 * и `projectName`. Оба варианта принимаются, чтобы правка схемы на десктопе не
 * ломала импорт.
 */
function parseLine(
  line: string,
  projectId: string,
  machine: string | null,
): StatsRowInput | "unparsable" | "invalid" {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    // Может быть недописанным хвостом — отличаем от разобранного, но негодного.
    return "unparsable"
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "invalid"
  }
  const d = parsed as Record<string, unknown>

  const itemId = asString(d.itemId)
  // JSON целый, но без ключа дедупа — строка бесполезна и дописыванием не
  // починится, поэтому считаем её прочитанной, а не хвостом.
  if (!itemId) return "invalid"

  const outPaths = Array.isArray(d.out)
    ? d.out
    : Array.isArray(d.outPaths)
      ? d.outPaths
      : []

  return {
    itemId,
    projectId,
    schemaVersion: asInt4(d.schemaVersion) ?? 1,
    status: (asString(d.status) ?? "unknown").toLowerCase(),
    projectName: asString(d.project) ?? asString(d.projectName) ?? "",
    mainFolder: asString(d.mainFolder) ?? "",
    curItem: asString(d.curItem) ?? "",
    inType: asString(d.inType),
    outType: asString(d.outType),
    registeredAt: asTimestamp(d.registeredAt),
    startedAt: asTimestamp(d.startedAt),
    endedAt: asTimestamp(d.endedAt),
    outSec: asInt4(d.outSec),
    srcSec: asInt4(d.srcSec),
    renderSec: asInt4(d.renderSec),
    outPaths: JSON.stringify(outPaths),
    totalCost: asCost(d.totalCost),
    machine,
  }
}

/**
 * Вставка пачкой с откатом на построчную.
 *
 * Пачка — это одна транзакция: строка, которую база не приняла (значение вне
 * границ колонки, битая кодировка), отменила бы вставку всех двухсот и заодно
 * обновление курсора. Тогда тот же файл падал бы на том же месте каждый час, а
 * остальные его строки не попали бы в базу никогда. Поэтому при ошибке пачки
 * строки вставляются по одной, и потерянной оказывается ровно виновная.
 */
async function insertRows(
  rows: StatsRowInput[],
): Promise<{ inserted: number; rejected: number }> {
  if (rows.length === 0) return { inserted: 0, rejected: 0 }
  try {
    return { inserted: await insertBatch(rows), rejected: 0 }
  } catch (error) {
    console.warn(
      `[stats] batch insert failed (${rows.length} rows), retrying row by row`,
      error,
    )
    let inserted = 0
    let rejected = 0
    for (const row of rows) {
      try {
        inserted += await insertBatch([row])
      } catch (rowError) {
        rejected++
        console.error("[stats] row rejected", row.itemId, rowError)
      }
    }
    return { inserted, rejected }
  }
}

async function insertBatch(rows: StatsRowInput[]): Promise<number> {
  if (rows.length === 0) return 0
  const params: unknown[] = []
  const tuples = rows.map((r) => {
    const start = params.length
    params.push(
      r.itemId,
      r.projectId,
      r.schemaVersion,
      r.status,
      r.projectName,
      r.mainFolder,
      r.curItem,
      r.inType,
      r.outType,
      r.registeredAt,
      r.startedAt,
      r.endedAt,
      r.outSec,
      r.srcSec,
      r.renderSec,
      r.outPaths,
      r.totalCost,
      r.machine,
    )
    const p = (offset: number) => `$${start + offset}`
    return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)},
             ${p(10)}::timestamptz, ${p(11)}::timestamptz, ${p(12)}::timestamptz,
             ${p(13)}::int, ${p(14)}::int, ${p(15)}::int, ${p(16)}::jsonb,
             ${p(17)}::numeric, ${p(18)})`
  })

  const result = await query(
    `INSERT INTO processing_stats (
       item_id, project_id, schema_version, status, project_name, main_folder,
       cur_item, in_type, out_type, registered_at, started_at, ended_at,
       out_sec, src_sec, render_sec, out_paths, total_cost, machine
     ) VALUES ${tuples.join(", ")}
     ON CONFLICT (item_id) DO NOTHING`,
    params,
  )
  return result.rowCount ?? 0
}

type StatsObject = { key: string; etag: string | null }

/** Листинг `options/_stats/` одного проекта. Возвращает ключи с их версиями. */
async function listStatsObjects(
  userId: string,
  projectId: string,
): Promise<StatsObject[]> {
  const prefix = `${projectPrefix(userId, projectId)}options/_stats/`
  const client = getS3Client()
  const bucket = getS3Bucket()
  const found: StatsObject[] = []

  let token: string | undefined
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue
      if (!/\.jsonl$/i.test(obj.Key)) continue
      found.push({ key: obj.Key, etag: obj.ETag?.replace(/"/g, "") ?? null })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)

  return found
}

export async function importProcessingArchive(options?: {
  maxFiles?: number
}): Promise<ImportArchiveResult> {
  const result: ImportArchiveResult = {
    projectsScanned: 0,
    filesSeen: 0,
    filesRead: 0,
    linesRead: 0,
    rowsInserted: 0,
    duplicates: 0,
    malformed: 0,
    partial: 0,
    filesSkipped: 0,
    errors: 0,
  }
  if (!isS3Configured()) return result

  const maxFiles = options?.maxFiles ?? MAX_FILES_PER_RUN
  // Архивные и приостановленные проекты тоже сканируем: их история не менее
  // ценна, а файлы никуда не делись.
  const projects = await query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM projects`,
  )

  const cursors = await query<{
    s3_key: string
    lines_imported: number
    etag: string | null
  }>(`SELECT s3_key, lines_imported, etag FROM stats_import_state`)
  const cursorByKey = new Map(cursors.rows.map((r) => [r.s3_key, r]))

  for (const project of projects.rows) {
    if (result.filesRead >= maxFiles) break
    result.projectsScanned++

    let objects: StatsObject[]
    try {
      objects = await listStatsObjects(project.user_id, project.id)
    } catch (error) {
      result.errors++
      console.error("[stats] list _stats failed", project.id, error)
      continue
    }

    for (const object of objects) {
      if (result.filesRead >= maxFiles) break
      result.filesSeen++

      const cursor = cursorByKey.get(object.key)
      // Версия объекта меняется при каждом дописывании, поэтому неизменившийся
      // etag — точный признак «скачивать нечего». Это и есть вся экономия.
      if (cursor?.etag && object.etag && cursor.etag === object.etag) {
        result.filesSkipped++
        continue
      }

      try {
        const file = await getObjectTextWithMeta(object.key)
        if (!file) {
          result.filesSkipped++
          continue
        }
        result.filesRead++

        const machine = machineFromStatsKey(object.key)
        const lines = file.body.split("\n")
        while (lines.length > 0 && lines[lines.length - 1]?.trim() === "") {
          lines.pop()
        }

        let consumed = cursor?.lines_imported ?? 0
        if (consumed > lines.length) {
          // Файл стал короче, чем курсор: append-only нарушен (объект
          // перезаписали целиком). Читаем заново — дедуп по item_id это
          // обесценивает в ноль лишних строк.
          console.warn(
            `[stats] cursor ahead of file, re-reading: ${object.key} (${consumed} > ${lines.length})`,
          )
          consumed = 0
        }

        const fresh = lines.slice(consumed)
        const rows: StatsRowInput[] = []
        let processed = 0
        let partialTail = false

        for (let i = 0; i < fresh.length; i++) {
          const line = fresh[i] ?? ""
          if (line.trim() === "") {
            processed++
            continue
          }
          const row = parseLine(line, project.id, machine)
          if (row === "unparsable" && i === fresh.length - 1) {
            // Последняя строка могла быть недописана на момент заливки. Не
            // съедаем её курсором: дочитаем, когда файл дополнят.
            partialTail = true
            result.partial++
            break
          }
          if (row === "unparsable" || row === "invalid") {
            result.malformed++
            processed++
            continue
          }
          rows.push(row)
          processed++
        }

        result.linesRead += processed

        for (let i = 0; i < rows.length; i += INSERT_BATCH) {
          const batch = rows.slice(i, i + INSERT_BATCH)
          const { inserted, rejected } = await insertRows(batch)
          result.rowsInserted += inserted
          result.malformed += rejected
          result.duplicates += batch.length - inserted - rejected
        }

        await query(
          `INSERT INTO stats_import_state (s3_key, project_id, lines_imported, etag, imported_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (s3_key) DO UPDATE
              SET lines_imported = EXCLUDED.lines_imported,
                  etag           = EXCLUDED.etag,
                  project_id     = EXCLUDED.project_id,
                  imported_at    = NOW()`,
          [
            object.key,
            project.id,
            consumed + processed,
            // Версия запоминается всегда, даже когда хвост недописан. Курсор
            // при этом стоит перед этой строкой, поэтому файл перечитается,
            // как только машина в него что-нибудь допишет и etag изменится. Если
            // не допишет — перечитывать нечего, а сброс версии заставлял бы
            // скачивать один и тот же файл каждый час до конца времён.
            file.etag ?? object.etag,
          ],
        )
      } catch (error) {
        result.errors++
        console.error("[stats] import file failed", object.key, error)
      }
    }
  }

  return result
}
