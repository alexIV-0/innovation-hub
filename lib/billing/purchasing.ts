import { query } from "@/lib/db"
import { rateForPair } from "@/lib/billing/settings"
import type { BillingSettings, PayMeter, PayPair } from "@/lib/billing/types"

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
 * По каким списаниям считаем факт.
 *
 * Проекты подарка, если он есть: обещание «столько-то минут» относится к нашим
 * шаблонам, и фактическую стоимость единицы в них мы знаем. Подарка нет — берём
 * всё, что человек обрабатывал сам: своя история честнее чужой ставки.
 *
 * Ни того, ни другого — `null`, и считать будет не по чему.
 */
export type Scope = {
  projectIds: string[]
  /** Владелец: запасная область, когда список проектов пуст. */
  userId?: string | null
}

function scopeFilter(scope: Scope): { where: string; params: unknown[] } | null {
  if (scope.projectIds.length > 0) {
    return { where: "b.project_id = ANY($1::text[])", params: [scope.projectIds] }
  }
  if (scope.userId) return { where: "b.user_id = $1", params: [scope.userId] }
  return null
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

/**
 * «На что ещё хватит» по каждой мере сразу — для виджета баланса и кошелька.
 *
 * ⚠️ Это варианты, а не сумма. «1 200 ₽ = 20 минут ИЛИ 15 файлов» — одно и то
 * же, посчитанное разными линейками, и интерфейс обязан показать их через
 * «или», иначе число прочитается как «и то, и другое».
 *
 * Точным быть не может и не пытается: неизвестно, какой проект запустят и
 * сколько там платных генераций. Поэтому стоимость единицы берётся из факта —
 * по уже случившимся списаниям, где внешние сервисы и наценка учтены, — и лишь
 * при отсутствии истории падает на голую ставку.
 */

/**
 * Мера пересчёта. `runs` — не ось тарификации, а вопрос «сколько раз ещё
 * запустить обработку»: его задают независимо от того, чем проект
 * тарифицируется, и ответ на него — полная стоимость одного прогона.
 */
export type CapacityMeter = PayMeter | "runs"

export type Capacity = {
  meter: CapacityMeter
  units: number
  basis: "history" | "rate"
}

/** Какой парой считаем каждую меру, когда истории нет. */
const FALLBACK_PAIR: Record<CapacityMeter, PayPair> = {
  sec: "output:sec",
  count: "output:count",
  bytes: "source:bytes",
  runs: "fixed",
}

async function medianByMeter(scope: Scope): Promise<Map<PayMeter, number>> {
  const out = new Map<PayMeter, number>()
  const filter = scopeFilter(scope)
  if (!filter) return out

  const result = await query<{ meter: PayMeter; value: string | null }>(
    `SELECT b.pay_meter AS meter,
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (b.our_cents + b.vendor_cents + b.margin_cents) / b.units
            )::text AS value
       FROM billing_transactions b
      WHERE ${filter.where}
        AND b.kind IN ('charge', 'exempt')
        AND b.pay_meter IS NOT NULL
        AND b.units > 0
        AND b.created_at > NOW() - INTERVAL '90 days'
      GROUP BY b.pay_meter`,
    filter.params,
  )
  for (const row of result.rows) {
    const value = row.value == null ? null : Number(row.value)
    if (value != null && Number.isFinite(value) && value > 0) {
      out.set(row.meter, value)
    }
  }
  return out
}

/**
 * Во что обходится ОДИН прогон целиком, безотносительно меры.
 *
 * Строка списания на задачу одна (уникальный индекс), поэтому медиана полной
 * суммы строки и есть «сколько стоит просто запустить обработку». Делить на
 * единицы здесь нельзя: вопрос как раз про то, сколько раз, а не сколько
 * секунд.
 */
async function medianCentsPerRun(scope: Scope): Promise<number | null> {
  const filter = scopeFilter(scope)
  if (!filter) return null

  const result = await query<{ value: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (b.our_cents + b.vendor_cents + b.margin_cents)
            )::text AS value
       FROM billing_transactions b
      WHERE ${filter.where}
        AND b.kind IN ('charge', 'exempt')
        AND (b.our_cents + b.vendor_cents + b.margin_cents) > 0
        AND b.created_at > NOW() - INTERVAL '90 days'`,
    filter.params,
  )
  const raw = result.rows[0]?.value
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function approximateCapacity(input: {
  availableCents: number
  projectIds: string[]
  /** Владелец: по его истории считаем, когда подарочных проектов нет. */
  userId?: string | null
  settings: BillingSettings
}): Promise<Capacity[]> {
  if (input.availableCents <= 0) return []

  const scope: Scope = { projectIds: input.projectIds, userId: input.userId }
  const [history, perRunFact] = await Promise.all([
    medianByMeter(scope),
    medianCentsPerRun(scope),
  ])
  const out: Capacity[] = []

  for (const meter of ["sec", "count", "bytes"] as const) {
    const fromHistory = history.get(meter)
    const perUnit = fromHistory ?? rateForPair(input.settings, FALLBACK_PAIR[meter])
    // Ни факта, ни ставки — переводить не во что. Показать ноль или «∞»
    // одинаково неправда, поэтому меру просто не показываем.
    if (perUnit == null || perUnit <= 0) continue
    out.push({
      meter,
      units: Math.floor(input.availableCents / perUnit),
      basis: fromHistory != null ? "history" : "rate",
    })
  }

  // Прогоны последними: это ответ на другой вопрос — не «сколько сделаю», а
  // «сколько раз нажму». Ставка `fixed` подходит запасным вариантом только
  // потому, что она и есть цена прогона целиком.
  const perRun = perRunFact ?? rateForPair(input.settings, FALLBACK_PAIR.runs)
  if (perRun != null && perRun > 0) {
    out.push({
      meter: "runs",
      units: Math.floor(input.availableCents / perRun),
      basis: perRunFact != null ? "history" : "rate",
    })
  }

  return out
}
