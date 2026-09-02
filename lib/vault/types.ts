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
  /**
   * Адрес ЭТОЙ установки. `null` — как у сервиса.
   *
   * Нужен, когда за одним слагом стоит несколько установок: два своих ComfyUI
   * на разных машинах — это один сервис (его знает плагин) и две учётки со
   * своими адресами, а не два сервиса. Слаг уникален, и вторым сервисом их не
   * развести.
   */
  baseUrl: string | null
  /**
   * Сколько живёт копия ЭТОГО ключа на машине. `null` — как у сервиса.
   *
   * У учётки, а не только у сервиса, потому что рядом живут наш рабочий ключ и
   * клиентский: чужой разумно отзывать быстрее, цена его утечки не наша.
   */
  keyTtlSec: number | null
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

/**
 * Что случилось в контуре ключей на машине (пункт 8 запроса клиента).
 *
 * Закрытый список кодов, а не текст: состояние проекта мы показываем и у себя,
 * и в программе, и разбирать строку ради значка — гарантированное расхождение.
 * Новый случай добавляется сюда, а не свободной строкой в поле.
 */
export const INCIDENT_CODES = [
  /** Ключа нет: учётка не заведена, отозвана или не досталась этой машине. */
  "key-missing",
  /** Вендор не принял ключ: протух, отозван на его стороне, неверный. */
  "key-rejected",
  /** Вендор отказал не из-за ключа: ошибка, недоступность, странный ответ. */
  "vendor-refused",
  /** У владельца учётки кончились деньги У ВЕНДОРА, а не у нас на балансе. */
  "owner-out-of-funds",
  /** Упёрлись в лимит или квоту вендора. */
  "quota-exceeded",
] as const
export type IncidentCode = (typeof INCIDENT_CODES)[number]

/**
 * Коды, при которых другие машины тоже не справятся, и гонять задачу по парку
 * бессмысленно — проект надо гасить.
 *
 * `vendor-refused` и `quota-exceeded` сюда НЕ входят: первое бывает разовым
 * сбоем вендора, второе проходит само со сменой суток.
 */
export const BLOCKING_INCIDENT_CODES: readonly IncidentCode[] = [
  "key-missing",
  "key-rejected",
  "owner-out-of-funds",
]

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
