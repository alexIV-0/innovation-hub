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
  /**
   * Страховочный обход папок IN — вторая линия сборки (lib/pipeline/sweep.ts).
   * Период в минутах; 0 — по таймеру не ходим, только по кнопке.
   */
  sweepIntervalMin: number
  sweptAt: string | null
  lastSwept: number
  lastSweepError: string | null
}

type StateRow = {
  isRunning: boolean
  startedAt: Date | null
  startedByEmail: string | null
  lastSeq: string
  lastCreated: number
  lastError: string | null
  scannedAt: Date | null
  sweepIntervalMin: number
  sweptAt: Date | null
  lastSwept: number
  lastSweepError: string | null
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
    sweepIntervalMin: row.sweepIntervalMin,
    sweptAt: row.sweptAt?.toISOString() ?? null,
    lastSwept: row.lastSwept,
    lastSweepError: row.lastSweepError,
  }
}

const SELECT_STATE = `
  SELECT s.is_running   AS "isRunning",
         s.started_at   AS "startedAt",
         u.email        AS "startedByEmail",
         s.last_seq::text AS "lastSeq",
         s.last_created AS "lastCreated",
         s.last_error   AS "lastError",
         s.scanned_at   AS "scannedAt",
         s.sweep_interval_min AS "sweepIntervalMin",
         s.swept_at           AS "sweptAt",
         s.last_swept         AS "lastSwept",
         s.last_sweep_error   AS "lastSweepError"
    FROM automation_scan_state s
    LEFT JOIN users u ON u.id = s.started_by
   WHERE s.id = 'singleton'
`

/**
 * Границы периода обхода. Совпадают с CHECK в схеме — держим их в одном месте с
 * валидацией API. Ноль легален и значит «по таймеру не ходить».
 */
export const SWEEP_INTERVAL_OFF = 0
export const SWEEP_INTERVAL_MAX = 1440

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
      sweepIntervalMin: 15,
      sweptAt: null,
      lastSwept: 0,
      lastSweepError: null,
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

/**
 * Пишет итог тика — по нему на странице видно, что цикл живой.
 *
 * `scanned_at` двигается здесь, то есть на КАЖДОМ тике. Раньше он писался только
 * в `writeCursor`, а тот вызывается лишь когда в журнале нашлись новые события —
 * из-за чего на странице «последняя проверка» замирала на моменте последней
 * загрузки файла и через сутки простоя выглядела так, будто цикл умер. Поле,
 * которое должно доказывать, что конвейер жив, ровно этого и не доказывало.
 *
 * Пишем и при ошибке тика: проверка была, просто не удалась, а причина видна
 * рядом в `last_error`. Замершее время рядом с ошибкой сбивало бы с толку сильнее.
 */
export async function recordTickResult(input: {
  created: number
  error: string | null
}): Promise<void> {
  await query(
    `UPDATE automation_scan_state
        SET last_created = $1,
            last_error = $2,
            scanned_at = NOW(),
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [input.created, input.error],
  )
}

/**
 * Период обхода. Меняет админ на закладке «Обход IN».
 *
 * 0 выключает расписание, но не кнопку «Обойти сейчас»: разовый прогон — явное
 * действие администратора, и запрещать его из-за того, что таймер снят, значило бы
 * отнимать единственный способ добрать застрявший файл сразу.
 */
export async function setSweepInterval(
  intervalMin: number,
): Promise<PipelineState> {
  await query(
    `UPDATE automation_scan_state
        SET sweep_interval_min = $1,
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [intervalMin],
  )
  return readPipelineState()
}

/**
 * Пишет итог обхода.
 *
 * `swept_at` двигается всегда, в том числе при ошибке и при нулевом результате:
 * от него считается следующий срок, и замри он на неудаче — обход пошёл бы на
 * каждом тике. Причина видна рядом в `last_sweep_error`.
 */
export async function recordSweepResult(input: {
  created: number
  error: string | null
}): Promise<void> {
  await query(
    `UPDATE automation_scan_state
        SET last_swept = $1,
            last_sweep_error = $2,
            swept_at = NOW(),
            updated_at = NOW()
      WHERE id = 'singleton'`,
    [input.created, input.error],
  )
}
