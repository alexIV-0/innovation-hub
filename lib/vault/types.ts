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

/**
 * Из чего состоит секрет этого сервиса: `apiKey`, либо `login` + `password`,
 * либо `client_id` + `client_secret`.
 *
 * Описание живёт у сервиса, поэтому форма заведения учётки одна на все сервисы
 * и рисуется по данным, а не по коду: новый вендор — строка в каталоге, а не
 * новое окно и пересборка программы с обеих сторон.
 */
export type SecretFieldSpec = {
  /** Ключ в объекте секрета. Он же приезжает на машину. */
  key: string
  /** Подпись в форме. Пусто — показываем сам ключ. */
  label: string
  /** Прятать ли ввод: логин прятать незачем, пароль — обязательно. */
  secret: boolean
}

/** Состав секрета по умолчанию: один ключ. Так у большинства вендоров. */
export const DEFAULT_SECRET_FIELDS: SecretFieldSpec[] = [
  { key: "apiKey", label: "", secret: true },
]

/**
 * Учётка под сервисом: своя пара «чем авторизоваться» и «чей расход».
 *
 * Их несколько, потому что требование пришло с двух сторон сразу: «тест и
 * прод» на одном вендоре и «клиент принёс свой ключ». Оба решаются владельцем
 * у учётки, а прайс при этом остаётся у сервиса — цена вендора не зависит от
 * того, чьим ключом позвали.
 */
export type VendorAccount = {
  id: string
  serviceId: string
  /** Метка: «main», «test», «ключ Иванова». Именно она уезжает в проект. */
  label: string
  /** NULL — наша учётка: расход наш и идёт в себестоимость. */
  ownerUserId: string | null
  /** Почта владельца, чтобы не искать её по id глазами. */
  ownerEmail: string | null
  status: VendorStatus
  createdAt: Date
  updatedAt: Date
  /** Живой секрет: версия и подсказка. Сами поля здесь не появляются никогда. */
  secret: { version: number; hint: string; createdAt: Date } | null
  /** Расход по этой учётке за 30 дней, копейки рублей. */
  spentMonthCents: number
}

export type VendorService = {
  id: string
  slug: string
  name: string
  adapter: string
  /**
   * Адрес сервиса. Пусто — адрес знает сама нода (О5): так у вендоров, чей
   * эндпоинт зашит в адаптере, и так останется. Заполненный адрес уезжает на
   * машину вместе с ключами, и менять его можно здесь, а не обходом парка.
   */
  baseUrl: string
  billingModel: VendorBillingModel
  currency: string
  delivery: VendorDelivery
  keyTtlSec: number
  dailyCapCents: number
  status: VendorStatus
  createdAt: Date
  updatedAt: Date
  /** Из чего состоит секрет учётки. Пусто — одно поле `apiKey`. */
  secretFields: SecretFieldSpec[]
  /**
   * Учётки сервиса. Пустой список — законное состояние: свой сервис, поднятый
   * рядом, может не требовать авторизации вовсе, и тогда у него есть только
   * адрес.
   */
  accounts: VendorAccount[]
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
