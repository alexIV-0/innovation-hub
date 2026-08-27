import {
  breakdownTotal,
  payPair,
  type ChargeBreakdown,
  type ChargeTerms,
  type PayBase,
  type PayMeter,
} from "@/lib/billing/types"

/**
 * Расчёт суммы. Чистые функции, без базы: их же зовёт оценка перед обработкой и
 * списание после, и разойтись эти два расчёта не должны.
 *
 * Формула (П5):
 *
 *     списание = единица × ставка  +  себестоимость × (1 + маржа)
 *                  наша цена            то, что мы заплатили за клиента
 *
 * Слагаемые разной природы: первое считает сайт по своему тарифу, второе
 * приходит от машины фактом. Сайт себестоимость не пересчитывает — только
 * приводит к рублям и наценивает.
 */

/**
 * Себестоимость из архива → копейки рублей.
 *
 * `amount` приходит в валюте вендора (контракт — доллар США): плагин отдаёт
 * `costUsd`, а `totalCost` в строке архива — одно число без валюты. `rate` —
 * рублей за единицу валюты, `adjustPct` — поправка на то, что реальная
 * конвертация по карте дороже биржевой.
 */
export function vendorCostToCents(input: {
  amount: number
  rate: number
  adjustPct: number
}): number {
  if (!Number.isFinite(input.amount) || input.amount <= 0) return 0
  const rubles = input.amount * input.rate * (1 + input.adjustPct / 100)
  return Math.max(0, Math.round(rubles * 100))
}

/**
 * Раскладка списания.
 *
 * Округление — только до копейки, тарифных «шагов» нет: посекундная
 * тарификация без минимального чека (В3). Пятнадцатисекундный ролик стоит
 * пятнадцать секунд.
 *
 * Маржа считается от себестоимости и лежит ОТДЕЛЬНЫМ полем, а не внутри
 * `vendorCents`. Пользователю показывается «сторонние сервисы» по
 * себестоимости: цифра, которую можно сверить с публичным прайсом сервиса, —
 * проверяемая правда, а наценка живёт в цене нашей услуги.
 */
export function computeBreakdown(input: {
  units: number
  unitRateCents: number
  vendorCents: number
  marginPct: number
}): ChargeBreakdown {
  const units = Number.isFinite(input.units) && input.units > 0 ? input.units : 0
  const vendorCents = Math.max(0, Math.round(input.vendorCents))
  return {
    ourCents: Math.max(0, Math.round(units * input.unitRateCents)),
    vendorCents,
    marginCents: Math.max(0, Math.round((vendorCents * input.marginPct) / 100)),
  }
}

export type PricedCharge = {
  breakdown: ChargeBreakdown
  totalCents: number
  terms: ChargeTerms
}

/** Полный расчёт с условиями, которые уедут в транзакцию и больше не изменятся. */
export function priceCharge(input: {
  base: PayBase
  meter: PayMeter | null
  units: number
  unitRateCents: number
  marginPct: number
  /** Себестоимость в валюте вендора, как пришла из архива. */
  vendorAmount?: number | null
  vendorCurrency?: string | null
  vendorRate?: number | null
  vendorRateSource?: string | null
  fxAdjustPct?: number
}): PricedCharge {
  // Себестоимость есть, а курса нет — считаем её нулём и запоминаем это в
  // условиях. Ронять списание нельзя: обработка уже сделана, деньги на вендора
  // уже потрачены, и отказ означал бы «раздали бесплатно».
  const vendorCents =
    input.vendorAmount && input.vendorRate
      ? vendorCostToCents({
          amount: input.vendorAmount,
          rate: input.vendorRate,
          adjustPct: input.fxAdjustPct ?? 0,
        })
      : 0

  const breakdown = computeBreakdown({
    units: input.units,
    unitRateCents: input.unitRateCents,
    vendorCents,
    marginPct: input.marginPct,
  })

  return {
    breakdown,
    totalCents: breakdownTotal(breakdown),
    terms: {
      base: input.base,
      meter: input.base === "fixed" ? null : input.meter,
      units: input.base === "fixed" ? 1 : input.units,
      unitRateCents: input.unitRateCents,
      marginPct: input.marginPct,
      vendorCurrency: input.vendorCurrency ?? null,
      vendorRate: input.vendorRate ?? null,
      vendorRateSource: input.vendorRateSource ?? null,
    },
  }
}

/**
 * Во что обойдётся минимально допустимый кусок работы — порог допуска в деньгах.
 *
 * Порог задан в единицах («10 секунд»), потому что так он остаётся осмысленным
 * при любой ставке. Но сравнивать его с остатком кошелька надо в деньгах,
 * поэтому здесь одна и та же ставка применяется к порогу.
 */
export function minAdmitCents(input: {
  minUnits: number
  unitRateCents: number
}): number {
  return Math.max(1, Math.round(input.minUnits * input.unitRateCents))
}

export { payPair }
