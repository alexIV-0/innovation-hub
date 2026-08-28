import { z } from "zod"
import { VENDOR_CURRENCIES } from "@/lib/billing/types"
import {
  BILLING_MODELS,
  DELIVERIES,
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

export const createServiceSchema = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  adapter: z.string().trim().max(64).default(""),
  billingModel: z.enum(BILLING_MODELS).default("prepaid"),
  currency: currencySchema.default("USD"),
  delivery: z.enum(DELIVERIES).default("keys"),
  /** Сколько живёт копия ключа на машине: от минуты до недели. */
  keyTtlSec: z.number().int().min(60).max(604_800).default(21_600),
  dailyCapCents: z.number().int().min(0).max(1e11).default(0),
  /** Ключ вендора. Обязателен: сервис без ключа не умеет ничего. */
  secret: z.string().min(8).max(8192),
})

export const updateServiceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  adapter: z.string().trim().max(64).optional(),
  billingModel: z.enum(BILLING_MODELS).optional(),
  currency: currencySchema.optional(),
  delivery: z.enum(DELIVERIES).optional(),
  keyTtlSec: z.number().int().min(60).max(604_800).optional(),
  dailyCapCents: z.number().int().min(0).max(1e11).optional(),
  status: z.enum(VENDOR_STATUSES).optional(),
})

export const rotateSecretSchema = z.object({
  secret: z.string().min(8).max(8192),
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
   * Версии, которые уже лежат в сейфе на машине. Совпало — сайт отвечает
   * «актуально» и не достаёт секрет вовсе.
   */
  known: z.record(slugSchema, z.number().int().positive()).optional(),
})

export const vendorUsageSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().trim().max(64).nullable().optional(),
  entries: z
    .array(
      z.object({
        service: slugSchema,
        unit: z.enum(PRICE_UNITS),
        /** Единицы, а не деньги. Деньги считает сайт по своему прайсу. */
        units: z.number().positive().max(1e12),
      }),
    )
    .min(1)
    .max(50),
})
