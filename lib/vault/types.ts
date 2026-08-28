/**
 * Типы и константы сейфа. Без `pg`: этот файл импортирует и клиентский экран
 * сервисов, а из репозитория в бандл уехал бы драйвер базы.
 *
 * Ровно та же причина, по которой отдельно живёт lib/billing/types.ts.
 *
 * Разбор решений — docs/VENDOR_SERVICES_PLAN.md.
 */

/** Как платим вендору. Влияет на то, чему верить при сверке (С6). */
export const BILLING_MODELS = ["prepaid", "postpaid", "subscription"] as const
export type VendorBillingModel = (typeof BILLING_MODELS)[number]

/**
 * Как ключ попадает к исполнителю (С4). `keys` — ключ едет на машину и живёт
 * там в сейфе со сроком; `proxy` — не покидает сервер ни при каких условиях.
 */
export const DELIVERIES = ["keys", "proxy"] as const
export type VendorDelivery = (typeof DELIVERIES)[number]

export const VENDOR_STATUSES = ["active", "paused", "revoked"] as const
export type VendorStatus = (typeof VENDOR_STATUSES)[number]

/** В чём вендор считает потребление. Деньги за единицу — в прайсе. */
export const PRICE_UNITS = ["token", "char", "sec", "image", "run"] as const
export type PriceUnit = (typeof PRICE_UNITS)[number]

export type VendorPrice = {
  unit: PriceUnit
  priceMicros: number
  effectiveFrom: Date
}

export type VendorService = {
  id: string
  slug: string
  name: string
  adapter: string
  billingModel: VendorBillingModel
  currency: string
  delivery: VendorDelivery
  keyTtlSec: number
  dailyCapCents: number
  status: VendorStatus
  createdAt: Date
  updatedAt: Date
  /** Живой ключ: версия и подсказка. Сам ключ здесь не появляется никогда. */
  secret: { version: number; hint: string; createdAt: Date } | null
  prices: VendorPrice[]
  /** Расход за 30 дней по нашему учёту, копейки рублей. */
  spentMonthCents: number
}

/** Микроединицы валюты → человеческая цена: 2 → «0.000002». */
export const PRICE_SCALE = 1_000_000

/**
 * Ошибка «таблицы ещё нет» (Postgres 42P01).
 *
 * Код выкатывается раньше миграции — это норма для этого проекта, а не авария.
 * Но два места читают сейф на горячем пути (пульс машины и проход списания), и
 * там незнакомая таблица обязана вести себя как пустая, а не ронять запрос:
 * иначе непринятая миграция гасит конвейер целиком.
 *
 * Проверяем именно код, а не текст: текст зависит от локали сервера.
 */
export function isMissingTable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "42P01"
  )
}
