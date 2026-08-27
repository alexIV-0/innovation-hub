import { query } from "@/lib/db"
import { rateForPair } from "@/lib/billing/settings"
import type { BillingSettings, PayBase, PayMeter, PayPair } from "@/lib/billing/types"

/**
 * Во что обойдётся элемент — до того, как его обработали.
 *
 * Оценка нужна только для резерва: не выпустить в очередь больше, чем влезает.
 * Точной она быть не обязана и, для выходных единиц, быть не может — что
 * получится, известно после обработки.
 *
 * Кроме случая, ради которого оси и разложили надвое: при `payBase = source`
 * количество известно ЗАРАНЕЕ. Манифест папки и размеры файлов лежат в каталоге,
 * значит резерв равен факту, и ни перерасхода, ни списаний в убыток в таких
 * проектах не бывает вовсе.
 */

export type EstimateSource = "exact" | "project" | "history" | "default"

export type Estimate = {
  units: number
  cents: number
  source: EstimateSource
  /** Точное количество, а не прогноз: резерв сойдётся с фактом до копейки. */
  exact: boolean
}

/** Элемент, по которому считаем. Ровно то, что сборка задачи уже знает. */
export type EstimateItem = {
  isFolder: boolean
  sizeBytes: number
  children?: { sizeBytes: number }[]
}

/**
 * Количество, известное до обработки. `null` — единица выходная, заранее не
 * посчитать.
 */
export function exactUnits(
  base: PayBase,
  meter: PayMeter | null,
  item: EstimateItem,
): number | null {
  if (base === "fixed") return 1
  if (base !== "source") return null

  if (meter === "count") {
    // Папка — это один элемент работы, но исходников в ней несколько, и платят
    // за каждый. У файла источник один.
    return item.isFolder ? (item.children?.length ?? 0) : 1
  }
  if (meter === "bytes") {
    return item.isFolder
      ? (item.children ?? []).reduce((sum, c) => sum + c.sizeBytes, 0)
      : item.sizeBytes
  }
  // source × sec — нужен srcSec, поле схемы v2 архива. Заранее не знаем.
  return null
}

/**
 * Сколько на самом деле стоила единица в этом проекте — по последним
 * завершённым списаниям.
 *
 * Медиана, а не среднее: одна тяжёлая генерация не должна задирать оценку всем
 * следующим элементам. Берём полную стоимость, включая внешние сервисы и маржу,
 * — ставка сайта одна только их часть, и оценка по ней систематически занижала
 * бы резерв в графах с генерациями.
 */
async function medianCentsPerUnit(projectId: string): Promise<number | null> {
  const result = await query<{ value: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (b.our_cents + b.vendor_cents + b.margin_cents) / b.units
            )::text AS value
       FROM billing_transactions b
      WHERE b.project_id = $1
        AND b.kind IN ('charge', 'exempt')
        AND b.units IS NOT NULL
        AND b.units > 0
        AND b.created_at > NOW() - INTERVAL '90 days'`,
    [projectId],
  )
  const raw = result.rows[0]?.value
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

/**
 * Медиана количества по последним обработкам проекта — сколько единиц обычно
 * выходит из одного элемента. Нужна там, где количество заранее неизвестно.
 */
async function medianUnits(projectId: string): Promise<number | null> {
  const result = await query<{ value: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b.units)::text AS value
       FROM billing_transactions b
      WHERE b.project_id = $1
        AND b.kind IN ('charge', 'exempt')
        AND b.units IS NOT NULL
        AND b.units > 0
        AND b.created_at > NOW() - INTERVAL '90 days'`,
    [projectId],
  )
  const raw = result.rows[0]?.value
  if (raw == null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : null
}

export async function estimateItem(input: {
  projectId: string
  base: PayBase
  meter: PayMeter | null
  pair: PayPair
  item: EstimateItem
  settings: BillingSettings
  /** Ожидаемое количество, заданное админом на проекте. Главнее истории. */
  projectEstimateUnits?: number | null
}): Promise<Estimate> {
  const rate = rateForPair(input.settings, input.pair) ?? 0

  const exact = exactUnits(input.base, input.meter, input.item)
  if (exact != null) {
    // Количество точное — но полную стоимость всё равно берём по истории, если
    // она есть: внешние сервисы в ставку не входят, а платить за них придётся.
    const perUnit = (await medianCentsPerUnit(input.projectId)) ?? rate
    return {
      units: exact,
      cents: Math.round(exact * perUnit),
      source: "exact",
      // Точным резерв остаётся, только пока стоимость единицы не гадаем.
      exact: perUnit === rate,
    }
  }

  const meter = input.meter ?? "sec"
  const units =
    input.projectEstimateUnits ??
    (await medianUnits(input.projectId)) ??
    input.settings.defaultEstimateUnits[meter]

  const source: EstimateSource =
    input.projectEstimateUnits != null
      ? "project"
      : units === input.settings.defaultEstimateUnits[meter]
        ? "default"
        : "history"

  const perUnit = (await medianCentsPerUnit(input.projectId)) ?? rate
  return {
    units,
    cents: Math.round(units * perUnit),
    source,
    exact: false,
  }
}
