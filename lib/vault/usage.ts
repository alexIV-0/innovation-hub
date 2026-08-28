import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import { vendorCostToCents } from "@/lib/billing/pricing"
import { readLatestRate } from "@/lib/billing/rates"
import { readBillingSettings } from "@/lib/billing/settings"
import { ACCOUNT_CURRENCY } from "@/lib/billing/types"
import { isMissingTable, PRICE_SCALE, type PriceUnit } from "@/lib/vault/types"

/**
 * Потребление внешних сервисов: сколько единиц ушло у кого в рамках задачи.
 *
 * Машина присылает ЕДИНИЦЫ, а не деньги (docs/VENDOR_SERVICES_PLAN.md, С4).
 * Деньги считаются здесь, по прайсу сервиса и курсу ЦБ, и применённые значения
 * уезжают в строку: правка прайса не должна переписывать прошлые обработки.
 *
 * Почему не доверяем деньгам от ноды: прайс, зашитый в плагин, размножается по
 * парку и разъезжается при первом же изменении цен у вендора, а проверить
 * присланное число нечем. Единицы же вендор подтверждает в ответе на вызов.
 */

export type UsageEntry = {
  serviceSlug: string
  unit: PriceUnit
  units: number
}

export type UsageResult = {
  recorded: number
  /** Уже были записаны раньше: повторный отчёт расход не удваивает. */
  duplicate: number
  /** Сервиса с таким слагом нет. */
  unknown: string[]
  /** Цена за эту меру не назначена — записать нечего, и ноль здесь был бы ложью. */
  unpriced: string[]
  /** Курса для валюты сервиса нет: считать не по чему, машина повторит позже. */
  noRate: string[]
}

type PricedRow = {
  serviceId: string
  currency: string
  priceMicros: string | null
}

/**
 * Действующая цена меры на сейчас.
 *
 * `null` в цене — это «не назначено», а не «бесплатно». Разница принципиальная:
 * записав ноль, мы сделали бы забытый прайс осознанным решением и занизили
 * себестоимость молча.
 */
async function priceFor(
  slug: string,
  unit: PriceUnit,
): Promise<PricedRow | null> {
  const result = await query<PricedRow>(
    `SELECT s.id AS "serviceId",
            s.currency,
            (SELECT p.price_micros::text
               FROM vendor_service_prices p
              WHERE p.service_id = s.id
                AND p.unit = $2
                AND p.effective_from <= NOW()
              ORDER BY p.effective_from DESC
              LIMIT 1) AS "priceMicros"
       FROM vendor_services s
      WHERE s.slug = $1 AND s.owner_user_id IS NULL`,
    [slug, unit],
  )
  return result.rows[0] ?? null
}

export async function recordUsage(input: {
  taskId: string
  projectId?: string | null
  computerId?: string | null
  entries: UsageEntry[]
}): Promise<UsageResult> {
  const out: UsageResult = {
    recorded: 0,
    duplicate: 0,
    unknown: [],
    unpriced: [],
    noRate: [],
  }
  if (input.entries.length === 0) return out

  const { settings } = await readBillingSettings()
  // Курс на валюту, а не на строку: в одной задаче может быть несколько
  // сервисов одной валюты, и дёргать ЦБ на каждый — лишняя работа.
  const rates = new Map<string, { rate: number; source: string } | null>()

  for (const entry of input.entries) {
    const priced = await priceFor(entry.serviceSlug, entry.unit)
    if (!priced) {
      out.unknown.push(entry.serviceSlug)
      continue
    }
    if (priced.priceMicros == null) {
      out.unpriced.push(`${entry.serviceSlug}:${entry.unit}`)
      continue
    }

    const currency = priced.currency.toUpperCase()
    if (!rates.has(currency)) {
      // Рубль в рубль — курс единица и никакого ЦБ: запрашивать курс рубля к
      // рублю значило бы поставить биллинг в зависимость от справочника там,
      // где пересчёта нет вовсе.
      if (currency === ACCOUNT_CURRENCY) {
        rates.set(currency, { rate: 1, source: "local" })
      } else {
        const found = await readLatestRate(currency)
        rates.set(
          currency,
          found ? { rate: found.rate, source: found.source } : null,
        )
      }
    }
    const fx = rates.get(currency) ?? null
    if (!fx) {
      out.noRate.push(currency)
      continue
    }

    const priceMicros = Number(priced.priceMicros)
    const amount = (entry.units * priceMicros) / PRICE_SCALE
    const cents = vendorCostToCents({
      amount,
      rate: fx.rate,
      // Поправка на то, что реальная конвертация по карте дороже биржевой. К
      // рублёвым сервисам она отношения не имеет: там ничего не конвертируется.
      adjustPct: currency === ACCOUNT_CURRENCY ? 0 : settings.fxAdjustPct,
    })

    const inserted = await query(
      `INSERT INTO vendor_usage (
         id, task_id, service_id, project_id, unit, units,
         price_micros, currency, fx_rate, fx_source, cents, computer_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (task_id, service_id, unit) DO NOTHING`,
      [
        randomUUID(),
        input.taskId,
        priced.serviceId,
        input.projectId ?? null,
        entry.unit,
        entry.units,
        priceMicros,
        currency,
        fx.rate,
        fx.source,
        cents,
        input.computerId ?? null,
      ],
    )

    if ((inserted.rowCount ?? 0) > 0) out.recorded++
    else out.duplicate++
  }

  return out
}

/**
 * Себестоимость задачи по строкам потребления.
 *
 * `null` — строк нет вовсе, и это не ноль: значит, нода ещё не умеет отчитываться
 * потреблением, и списание должно взять число из архива, как раньше. Вернув
 * здесь ноль, мы бы обнулили себестоимость всему парку в день выката.
 */
export async function usageCentsForTask(taskId: string): Promise<number | null> {
  try {
    const result = await query<{ cents: string | null }>(
      `SELECT SUM(cents)::text AS cents FROM vendor_usage WHERE task_id = $1`,
      [taskId],
    )
    const raw = result.rows[0]?.cents
    return raw == null ? null : Number(raw)
  } catch (error) {
    // Миграции нет — ведём себя как «строк нет»: списание возьмёт `total_cost`
    // из архива, ровно как до появления сейфа. Проход списания идёт по часам и
    // по всем задачам разом, и уронить его незаведённой таблицей нельзя.
    if (isMissingTable(error)) return null
    throw error
  }
}

/** Расход по сервисам за период — для карточек в админке и сверки (С6). */
export async function usageByService(days = 30): Promise<
  { serviceId: string; slug: string; cents: number; rows: number }[]
> {
  const result = await query<{
    serviceId: string
    slug: string
    cents: string
    rows: string
  }>(
    `SELECT u.service_id AS "serviceId",
            s.slug,
            SUM(u.cents)::text AS cents,
            COUNT(*)::text AS rows
       FROM vendor_usage u
       JOIN vendor_services s ON s.id = u.service_id
      WHERE u.created_at > NOW() - ($1 || ' days')::interval
      GROUP BY u.service_id, s.slug
      ORDER BY SUM(u.cents) DESC`,
    [days],
  )
  return result.rows.map((row) => ({
    serviceId: row.serviceId,
    slug: row.slug,
    cents: Number(row.cents),
    rows: Number(row.rows),
  }))
}
