import { query } from "@/lib/db"
import { rateForPair } from "@/lib/billing/settings"
import type { BillingSettings } from "@/lib/billing/types"

/**
 * «На что хватит» — остаток, переведённый в хронометраж.
 *
 * Деньги правильная единица учёта и неудобная единица понимания: «4 210 ₽» не
 * отвечает на вопрос, который человек задаёт на самом деле.
 *
 * Число ПРИМЕРНОЕ, и точным быть не может: неизвестно, какой проект запустят,
 * сколько там обращений к платным сервисам и во что они обойдутся. Поэтому
 * стоимость секунды берём из факта — по уже случившимся списаниям, где внешние
 * сервисы и наценка уже учтены, — и только при отсутствии истории падаем на
 * голую ставку. Деление остатка на ставку систематически врало бы в большую
 * сторону: ставка это лишь наша часть цены.
 */

export type Purchasing = {
  /** Секунды финального видео, которые ещё можно сделать. */
  runtimeSec: number
  /** Считали по истории списаний или по ставке. */
  basis: "history" | "rate"
}

/**
 * Сколько на самом деле стоила секунда результата в этих проектах.
 *
 * Медиана, а не среднее: один тяжёлый прогон не должен обрушить прогноз для
 * всех остальных.
 */
async function medianCentsPerSec(projectIds: string[]): Promise<number | null> {
  if (projectIds.length === 0) return null
  const result = await query<{ value: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (b.our_cents + b.vendor_cents + b.margin_cents) / b.units
            )::text AS value
       FROM billing_transactions b
      WHERE b.project_id = ANY($1::text[])
        AND b.kind IN ('charge', 'exempt')
        AND b.pay_meter = 'sec'
        AND b.units > 0
        AND b.created_at > NOW() - INTERVAL '90 days'`,
    [projectIds],
  )
  const raw = result.rows[0]?.value
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function approximateRuntime(input: {
  availableCents: number
  /** Проекты, по которым считаем стоимость секунды. Обычно пробный набор. */
  projectIds: string[]
  settings: BillingSettings
}): Promise<Purchasing | null> {
  if (input.availableCents <= 0) return { runtimeSec: 0, basis: "rate" }

  const fromHistory = await medianCentsPerSec(input.projectIds)
  const perSec = fromHistory ?? rateForPair(input.settings, "output:sec")

  // Ставки нет и истории нет — переводить не во что. Показать «≈ ∞» или ноль
  // одинаково неправда, поэтому не показываем ничего.
  if (perSec == null || perSec <= 0) return null

  return {
    runtimeSec: Math.floor(input.availableCents / perSec),
    basis: fromHistory != null ? "history" : "rate",
  }
}
