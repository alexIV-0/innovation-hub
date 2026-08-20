import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { query } from "@/lib/db"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

/**
 * Месячный экспорт архива обработок в служебный префикс бакета
 * (docs/STATISTICS_PLAN.md, «Одна дырка в этой схеме», пункт 3 порядка работ).
 *
 * Зачем, если файлы машин уже лежат в R2: они лежат **внутри папок проектов**.
 * Удалили проект — ушёл и его `_stats`, и восстановить базу с нуля будет нечем.
 * Этот экспорт от пользовательских папок не зависит.
 *
 * Один файл на месяц здесь безопасен, в отличие от машинного архива: писатель
 * ровно один — сайт, и проблемы «две машины затирают объект» не существует.
 *
 * Формат — дамп строк таблицы, а не схема v1: он сохраняет `project_id` и
 * `machine`, которых в машинной строке нет. Восстановление из него — прямой
 * INSERT, а не путь приёмника.
 */

export const SITE_STATS_PREFIX = "_site/stats/"

/**
 * Сколько строк соглашаемся собрать в память на один файл. Файл собирается
 * целиком в строку, поэтому предел здесь про память процесса, а не про схему:
 * 100 000 строк это порядка 40 МБ. Больше — нужен потоковый multipart, и до тех
 * пор экспорт честно отказывается, а не падает по OOM.
 */
const MAX_ROWS_PER_FILE = 100_000
/** Маркер актуальности файла: последняя `imported_at`, попавшая в него. */
const MARKER_KEY = "max-imported-at"
/**
 * Не перезаписываем один и тот же месяц чаще раза в сутки. Тик часовой, а
 * текущий месяц меняется почти каждый час: без этого предела горячий файл
 * заливался бы двадцать четыре раза в день целиком.
 */
const MIN_REWRITE_MS = 20 * 60 * 60 * 1000

export type ExportMonthlyResult = {
  monthsChecked: number
  filesWritten: number
  rowsWritten: number
  filesSkipped: number
  errors: number
}

export function monthlyExportKey(year: number, month: number): string {
  return `${SITE_STATS_PREFIX}${year}.${String(month).padStart(2, "0")}.jsonl`
}

type MonthRef = { year: number; month: number }

type ObjectState = { marker: string | null; lastModified: Date | null }

async function readObjectState(key: string): Promise<ObjectState> {
  try {
    const head = await getS3Client().send(
      new HeadObjectCommand({ Bucket: getS3Bucket(), Key: key }),
    )
    return {
      marker: head.Metadata?.[MARKER_KEY] ?? null,
      lastModified: head.LastModified ?? null,
    }
  } catch {
    // Нет объекта — нет и маркера: значит экспортируем.
    return { marker: null, lastModified: null }
  }
}

/**
 * Месяцы, по которым в базе есть строки. Списком из последних двух месяцев
 * обойтись нельзя: бэкфилл приносит старые месяцы задним числом, и они попали бы
 * в базу, но никогда — в копию, ради которой этот модуль и существует.
 */
async function monthsWithRows(): Promise<MonthRef[]> {
  const result = await query<{ month: string }>(
    `SELECT to_char(date_trunc('month', COALESCE(ended_at, imported_at)), 'YYYY-MM') AS month
       FROM processing_stats
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 240`,
  )
  return result.rows.flatMap((row) => {
    const [year, month] = row.month.split("-")
    const y = Number(year)
    const m = Number(month)
    return Number.isFinite(y) && Number.isFinite(m)
      ? [{ year: y, month: m }]
      : []
  })
}

/**
 * Месяц строки определяется по `COALESCE(ended_at, imported_at)`: обработка
 * относится к тому месяцу, когда закончилась, а если времени окончания нет —
 * к месяцу, когда её импортировали. Иначе такие строки не попали бы никуда.
 */
export async function exportMonthlyStats(): Promise<ExportMonthlyResult> {
  const result: ExportMonthlyResult = {
    monthsChecked: 0,
    filesWritten: 0,
    rowsWritten: 0,
    filesSkipped: 0,
    errors: 0,
  }
  if (!isS3Configured()) return result

  const months = await monthsWithRows().catch((error) => {
    console.error("[stats] monthly export: month list failed", error)
    return [] as MonthRef[]
  })

  for (const { year, month } of months) {
    result.monthsChecked++
    const key = monthlyExportKey(year, month)
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`

    try {
      const summary = await query<{ rows: number; max_imported: string | null }>(
        `SELECT COUNT(*)::int AS rows,
                MAX(imported_at)::text AS max_imported
           FROM processing_stats
          WHERE COALESCE(ended_at, imported_at) >= $1::date
            AND COALESCE(ended_at, imported_at) <  ($1::date + INTERVAL '1 month')`,
        [monthStart],
      )
      const rows = summary.rows[0]?.rows ?? 0
      const maxImported = summary.rows[0]?.max_imported ?? null
      if (rows === 0) {
        result.filesSkipped++
        continue
      }
      if (rows > MAX_ROWS_PER_FILE) {
        result.errors++
        console.error(
          `[stats] monthly export skipped: ${key} has ${rows} rows, over the ${MAX_ROWS_PER_FILE} in-memory limit`,
        )
        continue
      }

      const state = await readObjectState(key)
      // Ничего не импортировали с прошлого экспорта — перезаписывать нечего.
      if (state.marker && maxImported && state.marker === maxImported) {
        result.filesSkipped++
        continue
      }
      // Файл есть и он свежий: подождём сутки, чтобы не переливать месяц каждый час.
      if (
        state.lastModified &&
        Date.now() - state.lastModified.getTime() < MIN_REWRITE_MS
      ) {
        result.filesSkipped++
        continue
      }

      const data = await query<Record<string, unknown>>(
        `SELECT item_id, project_id, schema_version, status, project_name,
                main_folder, cur_item, in_type, out_type,
                registered_at, started_at, ended_at, out_sec, render_sec,
                out_paths, total_cost, machine, imported_at
           FROM processing_stats
          WHERE COALESCE(ended_at, imported_at) >= $1::date
            AND COALESCE(ended_at, imported_at) <  ($1::date + INTERVAL '1 month')
          ORDER BY COALESCE(ended_at, imported_at)`,
        [monthStart],
      )

      const body = `${data.rows.map((row) => JSON.stringify(row)).join("\n")}\n`
      await getS3Client().send(
        new PutObjectCommand({
          Bucket: getS3Bucket(),
          Key: key,
          Body: body,
          ContentType: "application/x-ndjson",
          Metadata: {
            [MARKER_KEY]: maxImported ?? "",
            rows: String(data.rows.length),
          },
        }),
      )

      result.filesWritten++
      result.rowsWritten += data.rows.length
    } catch (error) {
      result.errors++
      console.error("[stats] monthly export failed", key, error)
    }
  }

  return result
}
