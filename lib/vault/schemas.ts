import { z } from "zod"
import { VENDOR_CURRENCIES } from "@/lib/billing/types"
import {
  BILLING_MODELS,
  DELIVERIES,
  INCIDENT_CODES,
  PRICE_UNITS,
  VENDOR_STATUSES,
} from "@/lib/vault/types"

/**
 * Формы запросов сейфа: админских и машинных.
 *
 * Одним файлом, потому что валюта, меры и способы доставки должны совпадать по
 * обе стороны. Разъедься они — админ завёл бы сервис с мерой, которую машинный
 * API не принимает, и увидел бы это только на первой обработке.
 */

/** Слаг: по нему машина просит ключ, поэтому только то, что нельзя перепутать. */
const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Only lowercase letters, digits and dashes.")

// Валюта прайса — из того же списка, что валюты себестоимости в биллинге, плюс
// рубль: сервис может выставлять счёт и в рублях, и тогда пересчёта нет вовсе.
const currencySchema = z.enum([...VENDOR_CURRENCIES, "RUB"] as [string, ...string[]])

/**
 * Адрес сервиса. Либо пусто, либо настоящий http(s)-адрес: «почти адрес»
 * обнаружился бы на первой обработке, а не при заведении.
 */
const baseUrlSchema = z
  .union([z.literal(""), z.string().trim().url().max(500)])
  .default("")

/**
 * Метка учётки: она уезжает в options.json проекта и в запрос ноды, поэтому
 * ограничена так же строго, как слаг, — но допускает кириллицу: «ключ Иванова»
 * человеку понятнее, чем `ivanov-key`.
 */
const accountLabelSchema = z.string().trim().min(1).max(64)

/** Из чего состоит секрет сервиса. Пусто — одно поле `apiKey`. */
const secretFieldsSchema = z
  .array(
    z.object({
      key: z
        .string()
        .trim()
        .min(1)
        .max(48)
        .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "Field keys are identifiers."),
      label: z.string().trim().max(80).default(""),
      secret: z.boolean().default(true),
    }),
  )
  .max(8)
  .default([])

/** Значения полей секрета: `{ apiKey: "…" }` или `{ login, password }`. */
const secretValuesSchema = z.record(
  z.string().trim().min(1).max(48),
  z.string().min(1).max(8192),
)

export const createServiceSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  adapter: z.string().trim().max(64).default(""),
  baseUrl: baseUrlSchema,
  billingModel: z.enum(BILLING_MODELS).default("prepaid"),
  currency: currencySchema.default("USD"),
  delivery: z.enum(DELIVERIES).default("keys"),
  /** Сколько живёт копия ключа на машине: от минуты до недели. */
  keyTtlSec: z.number().int().min(60).max(604_800).default(21_600),
  dailyCapCents: z.number().int().min(0).max(1e11).default(0),
  secretFields: secretFieldsSchema,
  /**
   * Первая учётка. Необязательна: свой сервис, поднятый рядом, может не
   * требовать авторизации — у него есть адрес и нет ключей. Пусто означает
   * «учёток нет», и машина видит `hasSecret: false`, а не пустой ключ, который
   * приняла бы за настоящий.
   */
  account: z
    .object({
      label: accountLabelSchema.default("main"),
      fields: secretValuesSchema,
      /** Срок копии этого ключа. Пусто — как у сервиса. */
      keyTtlSec: z.number().int().min(60).max(604_800).nullable().default(null),
    })
    .nullable()
    .default(null),
})

export const createAccountSchema = z.object({
  label: accountLabelSchema,
  /** Адрес этой установки. Пусто — как у сервиса. */
  baseUrl: baseUrlSchema,
  keyTtlSec: z.number().int().min(60).max(604_800).nullable().default(null),
  /**
   * Владелец — ПОЧТОЙ, а не id: id клиента админ наизусть не помнит, а почта
   * это и есть то, чем человека называют в разговоре. Роут переводит её в id и
   * отвечает 404, если такого человека нет.
   *
   * Пусто — наша учётка: расход наш и идёт в себестоимость.
   */
  ownerEmail: z.string().trim().email().max(200).nullable().default(null),
  fields: secretValuesSchema,
})

export const updateAccountSchema = z.object({
  label: accountLabelSchema.optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  baseUrl: baseUrlSchema.optional(),
  keyTtlSec: z.number().int().min(60).max(604_800).nullable().optional(),
})

export const rotateAccountSecretSchema = z.object({
  fields: secretValuesSchema,
})

export const updateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  adapter: z.string().trim().max(64).optional(),
  baseUrl: baseUrlSchema.optional(),
  billingModel: z.enum(BILLING_MODELS).optional(),
  currency: currencySchema.optional(),
  delivery: z.enum(DELIVERIES).optional(),
  keyTtlSec: z.number().int().min(60).max(604_800).optional(),
  dailyCapCents: z.number().int().min(0).max(1e11).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
  secretFields: secretFieldsSchema.optional(),
})

export const addPriceSchema = z.object({
  unit: z.enum(PRICE_UNITS),
  /**
   * Цена за единицу в МИКРОединицах валюты сервиса: токен за $0.000002 в
   * центах округлился бы в ноль, и потребление стало бы бесплатным.
   */
  priceMicros: z.number().int().min(0).max(1e15),
  /** Пусто — с этой секунды. Прошлые списания не пересчитываются никогда. */
  effectiveFrom: z.string().datetime().nullable().optional(),
})

// ─── Машинные ────────────────────────────────────────────────────────────────

export const vendorKeysSchema = z.object({
  /** Слаги сервисов, нужных ТЕКУЩИМ задачам машины, а не весь сейф. */
  services: z.array(slugSchema).min(1).max(50),
  /**
   * Что уже лежит в сейфе на машине: слаг → учётка и её версия. Совпало — сайт
   * отвечает «актуально» и не достаёт секрет вовсе.
   *
   * Пара, а не одна версия: нумерация у каждой учётки своя, и `v3` у `main`
   * совпал бы с `v3` у `test`, подтвердив машине чужой ключ как актуальный.
   */
  known: z
    .record(
      // Ключ — `слаг` или `слаг/метка`: по одному сервису машина держит теперь
      // несколько учёток, и без метки в ключе вторая затирала бы первую.
      z.string().trim().min(2).max(120),
      z.object({
        account: accountLabelSchema,
        version: z.number().int().positive(),
      }),
    )
    .optional(),
  /**
   * Под какую задачу просят ключи. Нужно, чтобы выдать учётку ВЛАДЕЛЬЦА задачи:
   * проект пользователя А на воркере парка должен работать ключом А, а не
   * нашим. Решает это сайт — у машины выбирать не из чего.
   */
  taskId: z.string().uuid().optional(),
})

export const vendorUsageSchema = z
  .object({
    /**
     * Задача, под которую считается расход. `null` — локальный прогон:
     * настройка флоу на машине, которую никому не продают. Такие строки в
     * списание не идут, а в суточную сверку идут: у вендора деньги списались.
     */
    taskId: z.string().uuid().nullable().optional(),
    /**
     * Чем дедуплицировать локальный прогон. Обязателен ровно тогда, когда
     * задачи нет: отчёт может уехать дважды при обрыве связи, и повтор не
     * должен удваивать расход.
     */
    runId: z.string().trim().min(8).max(64).optional(),
    projectId: z.string().trim().max(64).nullable().optional(),
    entries: z
      .array(
        z.object({
          service: slugSchema,
          unit: z.enum(PRICE_UNITS),
          /** Единицы, а не деньги. Деньги считает сайт по своему прайсу. */
          units: z.number().positive().max(1e12),
          /**
           * Метка учётки, которой звали вендора — та же, что пришла в выдаче.
           * Считать «чей это расход» ноде не нужно: владельца знаем мы.
           */
          account: accountLabelSchema.optional(),
        }),
      )
      .min(1)
      .max(50),
  })
  // Ровно одно из двух. Обе сразу означали бы, что расход принадлежит и задаче,
  // и отдельному прогону, а ни одной — что дедуплицировать его нечем.
  .refine((value) => (value.taskId != null) !== (value.runId != null), {
    message: "Provide either taskId or runId, not both.",
  })

/**
 * Инцидент в контуре ключей, замеченный машиной (пункт 8 запроса клиента).
 *
 * Узкое API, а не слив логов: код, слаг сервиса и, если известно, учётка,
 * задача и проект. Ошибки этого контура возникают НА МАШИНЕ — ключ протух в
 * момент вызова, вендор отказал, у клиента кончились деньги, — и не попади они
 * в журнал, половина картины осталась бы в логах, а треугольник на карточке
 * проекта знал бы только то, что заметили мы.
 */
export const vendorIncidentSchema = z.object({
  code: z.enum(INCIDENT_CODES),
  service: slugSchema,
  account: accountLabelSchema.optional(),
  taskId: z.string().uuid().optional(),
  projectId: z.string().trim().max(64).optional(),
  /**
   * Ответ вендора одной строкой — для человека, который будет разбираться.
   * Решения по нему не принимаются: для этого есть `code`.
   */
  detail: z.string().trim().max(500).optional(),
})
