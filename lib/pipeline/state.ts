import { query } from "@/lib/db"

/**
 * Состояние конвейера — единственная строка automation_scan_state.
 *
 * Слежение это состояние, а не действие: включили — конвейер следит за папками
 * IN и создаёт объекты для обработки, пока не выключили. Поэтому флаг лежит в
 * базе, а фоновый цикл читает его на каждом тике. Запуск и остановка — обычный
 * UPDATE, никаких сигналов в процесс посылать не нужно, и состояние переживает
 * закрытие страницы и перезапуск сервера.
 */

export type PipelineState = {
  isRunning: boolean
  startedAt: string | null
  startedByEmail: string | null
  lastSeq: number
  lastCreated: number
  lastError: string | null
  scannedAt: string | null
}

type StateRow = {
  isRunning: boolean
  startedAt: Date | null
  startedByEmail: string | null
  lastSeq: string
  lastCreated: number
  lastError: string | null
  scannedAt: Date | null
}

function toState(row: StateRow): PipelineState {
  return {
    isRunning: row.isRunning,
    startedAt: row.startedAt?.toISOString() ?? null,
    startedByEmail: row.startedByEmail,
    lastSeq: Number(row.lastSeq),
    lastCreated: row.lastCreated,
    lastError: row.lastError,
    scannedAt: row.scannedAt?.toISOString() ?? null,
  }
}

const SELECT_STATE = `
  SELECT s.is_running   AS "isRunning",
         s.started_at   AS "startedAt",
         u.email        AS "startedByEmail",
         s.last_seq::text AS "lastSeq",
         s.last_created AS "lastCreated",
         s.last_error   AS "lastError",
         s.scanned_at   AS "scannedAt"
    FROM automation_scan_state s
    LEFT JOIN users u ON u.id = s.started_by
   WHERE s.id = 'singleton'
`

export async function readPipelineState(): Promise<PipelineState> {
  const result = await query<StateRow>(SELECT_STATE)
  const row = result.rows[0]
  if (!row) {
    // Строку создаёт миграция; если её нет, конвейер считаем выключенным, а не
    // падаем — страница должна открыться и показать состояние «остановлен».
    return {
      isRunning: false,
      startedAt: null,
      startedByEmail: null,
      lastSeq: 0,
      lastCreated: 0,
      lastError: null,
      scannedAt: null,
    }
  }
  return toState(row)
}

/**
 * Включает или выключает слежение.
 *
 * При остановке чистим last_error: он относился к прошлому прогону, и висеть на
 * остановленном конвейере ему незачем. При запуске оставляем как есть до первого
 * тика — иначе непонятно, чем закончился предыдущий.
 */
export async function setPipelineRunning(input: {
  running: boolean
  adminUserId: string
}): Promise<PipelineState> {
  await query(
    `UPDATE automation_scan_state
        SET is_running = $1,
            started_at = CASE WHEN $1 THEN NOW() ELSE started_at END,
            started_by = CASE WHEN $1 THEN $2::text ELSE started_by END,
            last_error = CASE WHEN $1 THEN last_error ELSE NULL END,
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [input.running, input.adminUserId],
  )
  return readPipelineState()
}

/** Пишет итог тика — по нему на странице видно, что цикл живой. */
export async function recordTickResult(input: {
  created: number
  error: string | null
}): Promise<void> {
  await query(
    `UPDATE automation_scan_state
        SET last_created = $1,
            last_error = $2,
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [input.created, input.error],
  )
}

export async function isPipelineRunning(): Promise<boolean> {
  const result = await query<{ isRunning: boolean }>(
    `SELECT is_running AS "isRunning" FROM automation_scan_state WHERE id = 'singleton'`,
  )
  return result.rows[0]?.isRunning === true
}
