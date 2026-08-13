import { collectTasks } from "@/lib/pipeline/scan"
import { isPipelineRunning, recordTickResult } from "@/lib/pipeline/state"

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
 */

const TICK_INTERVAL_MS = 15_000

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
      if (!(await isPipelineRunning())) return

      const result = await collectTasks()
      await recordTickResult({ created: result.created, error: null })

      if (result.created > 0) {
        console.log(
          `[pipeline-runner] создано задач: ${result.created} (событий ${result.scannedEvents}, курсор ${result.cursor})`,
        )
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
