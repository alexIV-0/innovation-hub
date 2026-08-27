import { refreshRatesFromCbr } from "@/lib/billing/rates"
import { closeExpiredGrants, settleUnbilled } from "@/lib/billing/settle"
import { exportMonthlyStats } from "@/lib/statistics/export-archive"
import { importProcessingArchive } from "@/lib/statistics/import-archive"
import { takeStorageSnapshot } from "@/lib/statistics/snapshots"

/**
 * Часовой тик статистики: снимок состояний, импорт архива обработок, месячный
 * экспорт копии архива в служебный префикс бакета и обновление курсов валют.
 *
 * Почему в процессе, а не только в cron-роуте: `/api/cron/storage-purge`
 * существует, но кто его дёргает — из репозитория не видно, `CRON_SECRET` нигде
 * не настраивается. Для снимков пропущенный день невосстановим, поэтому цикл
 * поднимается рядом с поллером чата и раннером конвейера (instrumentation.ts),
 * а роуты остаются вторым, ручным входом.
 *
 * Все три шага идемпотентны — снимок за сутки перезаписывается, строки архива
 * дедуплицируются по `item_id`, экспорт пропускается, если с прошлого раза
 * ничего не импортировали, — поэтому час это «последнее состояние дня» и
 * «догнать то, что дописали машины», а не двадцать четыре копии.
 */
const TICK_MS = 60 * 60 * 1000
const FIRST_TICK_MS = 30 * 1000

let started = false

export function startStatsLoop() {
  if (started) return
  started = true

  const tick = async () => {
    try {
      const { projects } = await takeStorageSnapshot()
      if (projects > 0) {
        console.log(`[stats] snapshot taken: ${projects} projects`)
      }
    } catch (error) {
      // Таблицы может ещё не быть (миграция не применена) — это не повод
      // ронять процесс, следующий тик попробует снова.
      console.error("[stats] snapshot failed", error)
    }

    try {
      const result = await importProcessingArchive()
      if (result.rowsInserted > 0 || result.errors > 0) {
        console.log(
          `[stats] archive import: +${result.rowsInserted} rows, ` +
            `${result.filesRead} files read, ${result.filesSkipped} unchanged, ` +
            `${result.duplicates} dupes, ${result.malformed} malformed, ` +
            `${result.partial} partial, ${result.errors} errors`,
        )
      }
    } catch (error) {
      console.error("[stats] archive import failed", error)
    }

    try {
      // Списание идёт по строкам архива: только в них есть и хронометраж
      // результата, и себестоимость, и связь с задачей. Поэтому проход стоит
      // ПОСЛЕ импорта — иначе списывать было бы нечего, — но отдельным шагом:
      // упавшее списание не должно мешать импорту, а пропущенное подхватится
      // следующим часом.
      const settled = await settleUnbilled()
      if (settled.charged > 0 || settled.errors > 0) {
        console.log(
          `[billing] settle: ${settled.charged} charged, ${settled.exempt} exempt, ` +
            `${settled.skipped} skipped, ${settled.errors} errors`,
        )
      }
      const expired = await closeExpiredGrants()
      if (expired > 0) console.log(`[billing] подарков просрочено: ${expired}`)
    } catch (error) {
      console.error("[billing] settle failed", error)
    }

    try {
      // Курс нужен биллингу: себестоимость внешних сервисов приезжает в
      // долларах, а списываем мы рубли. Раз в час — с запасом: ЦБ обновляет
      // курс раз в сутки, а повторная запись за тот же день безвредна.
      const rates = await refreshRatesFromCbr()
      if (rates.saved > 0) {
        console.log(`[billing] rates ${rates.rateDay}: ${rates.saved} saved`)
      }
    } catch (error) {
      // Таблицы может ещё не быть (миграция не применена). Останавливать тик
      // из-за курсов нельзя: биллинг обходится последним известным значением.
      console.error("[billing] rates refresh failed", error)
    }

    try {
      const exported = await exportMonthlyStats()
      if (exported.filesWritten > 0) {
        console.log(
          `[stats] monthly export: ${exported.filesWritten} file(s), ` +
            `${exported.rowsWritten} rows`,
        )
      }
    } catch (error) {
      console.error("[stats] monthly export failed", error)
    }
  }

  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), TICK_MS)
  }, FIRST_TICK_MS)
}
