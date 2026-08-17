import { reapExpiredLeases } from "@/lib/pipeline/queue"
import { collectTasks } from "@/lib/pipeline/scan"
import {
  readPipelineState,
  recordSweepResult,
  recordTickResult,
  type PipelineState,
} from "@/lib/pipeline/state"
import { sweepInFolders } from "@/lib/pipeline/sweep"

/**
 * Фоновый цикл конвейера.
 *
 * Слежение включает и выключает админ кнопкой на /admin/pipeline, но сам цикл
 * живёт здесь и стартует один раз при загрузке процесса из instrumentation.ts —
 * ровно как chat-push-poller. Так работает, потому что приложение крутится
 * долгоживущим Node-процессом под pm2 (`next start`), а не в serverless.
 *
 * Флаг цикл читает из базы на каждом тике, а не держит в памяти: страницу
 * закрыли — слежение продолжается, процесс перезапустили — возобновляется само,
 * админов несколько — все видят одно состояние.
 *
 * Тик дешёвый, когда ничего не происходит: выборка по storage_changes с
 * seq > last_seq по индексу, и при пустом результате в объектное хранилище цикл
 * вообще не ходит.
 *
 * На тике две линии сборки. Событийная идёт каждый раз, страховочный обход
 * каталога (lib/pipeline/sweep.ts) — по своему интервалу, раз в 15 минут по
 * умолчанию. Обе подчинены одному флагу: «Стоп» значит, что задачи не появляются
 * вообще.
 */

const TICK_INTERVAL_MS = 15_000

/**
 * Пора ли обходить.
 *
 * Период 0 — расписание снято, обход остаётся только по кнопке в настройках.
 * Срок считается от конца прошлого обхода, а не от старта слежения: иначе
 * перезапуск процесса или пауза сдвигали бы расписание. Ни разу не проходил —
 * проходим сейчас.
 */
function sweepDue(state: PipelineState): boolean {
  if (state.sweepIntervalMin <= 0) return false
  if (!state.sweptAt) return true
  const dueAt =
    new Date(state.sweptAt).getTime() + state.sweepIntervalMin * 60_000
  return Date.now() >= dueAt
}

let started = false
/** Защита от наложения: тик может занять больше интервала на большой пачке. */
let ticking = false

export function startPipelineRunner(): void {
  if (started) return
  started = true

  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      // Протухшие аренды собираем ДО проверки флага и независимо от него:
      // машина могла умереть с задачей в руках уже после того, как слежение
      // выключили, и тогда задача осталась бы взятой навсегда.
      const reaped = await reapExpiredLeases()
      if (reaped > 0) {
        console.log(
          `[pipeline-runner] возвращено задач по протухшей аренде: ${reaped}`,
        )
      }

      const state = await readPipelineState()
      if (!state.isRunning) return

      const result = await collectTasks()
      await recordTickResult({ created: result.created, error: null })

      if (result.created > 0) {
        console.log(
          `[pipeline-runner] создано задач: ${result.created} (событий ${result.scannedEvents}, курсор ${result.cursor})`,
        )
      }

      // Обход в своём try: он вторая линия, и его падение не должно ни ронять
      // тик, ни затирать итог событийной сборки. Причина уезжает в
      // last_sweep_error, отдельно от last_error.
      if (sweepDue(state)) {
        try {
          const swept = await sweepInFolders()
          await recordSweepResult({ created: swept.created, error: null })
          if (swept.created > 0) {
            console.log(
              `[pipeline-sweep] добрано задач: ${swept.created} (осмотрено ${swept.scanned}, уже в очереди ${swept.known})`,
            )
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.error("[pipeline-sweep] обход не удался", error)
          await recordSweepResult({ created: 0, error: message }).catch(() => {})
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("[pipeline-runner] tick failed", error)
      // Ошибку кладём в состояние, чтобы она была видна на странице, а не только
      // в логах сервера. Цикл при этом не останавливаем: причина может быть
      // временной (недоступное хранилище), а сам конвейер остаётся включённым.
      await recordTickResult({ created: 0, error: message }).catch(() => {})
    } finally {
      ticking = false
    }
  }

  void tick()
  setInterval(() => void tick(), TICK_INTERVAL_MS)
}
