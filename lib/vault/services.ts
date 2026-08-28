import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import { decryptSecret, encryptSecret, secretHint } from "@/lib/vault/crypto"
import { isMissingTable } from "@/lib/vault/types"
import type {
  PriceUnit,
  VendorBillingModel,
  VendorDelivery,
  VendorService,
  VendorStatus,
} from "@/lib/vault/types"

/**
 * Сейф внешних сервисов: сервисы, их ключи и прайс.
 *
 * Правило файла: **наружу секрет уходит ровно из одной функции** —
 * `issueKeysForMachine`. Всё остальное отдаёт метаданные: имя, версию,
 * подсказку «••••4f21», дату. Разделение «список — метаданные, выдача —
 * секрет» повторяет то, что уже сделано в программе (`account_list` против
 * `account_get_token`), и держится оно здесь, а не на дисциплине вызывающих.
 *
 * Разбор решений — docs/VENDOR_SERVICES_PLAN.md.
 */

/**
 * Ревизия сейфа растёт на любую правку секретов и состава сервисов.
 *
 * Машина получает её в ответе на heartbeat и сравнивает со своей: разошлось —
 * идёт за ключами. Так отзыв доезжает за полминуты, а не по истечении TTL.
 */
export async function bumpVaultRevision(client?: PoolClient): Promise<void> {
  const sql = `UPDATE vendor_vault_state
                  SET revision = revision + 1, updated_at = NOW()
                WHERE id = 'singleton'`
  if (client) await client.query(sql)
  else await query(sql)
}

export async function readVaultRevision(): Promise<number> {
  try {
    const result = await query<{ revision: string }>(
      `SELECT revision::text AS revision FROM vendor_vault_state WHERE id = 'singleton'`,
    )
    return Number(result.rows[0]?.revision ?? 0)
  } catch (error) {
    // Миграция сейфа ещё не применена — отвечаем нулём. Ревизию читает КАЖДЫЙ
    // пульс машины: урони мы здесь запрос, весь парк потерял бы связь с сайтом
    // из-за незаведённой таблицы, к работе машин отношения не имеющей.
    if (isMissingTable(error)) return 0
    throw error
  }
}

// ─── Чтение для админки ──────────────────────────────────────────────────────

type ServiceRow = Omit<
  VendorService,
  "dailyCapCents" | "spentMonthCents" | "secret" | "prices"
> & {
  dailyCapCents: string
  spentMonthCents: string
  secretVersion: number | null
  secretHint: string | null
  secretCreatedAt: Date | null
  prices: { unit: PriceUnit; priceMicros: string; effectiveFrom: string }[] | null
}

const SERVICE_FIELDS = `
  s.id,
  s.slug,
  s.name,
  s.adapter,
  s.billing_model      AS "billingModel",
  s.currency,
  s.delivery,
  s.key_ttl_sec        AS "keyTtlSec",
  s.daily_cap_cents::text AS "dailyCapCents",
  s.status,
  s.created_at         AS "createdAt",
  s.updated_at         AS "updatedAt",
  live.version         AS "secretVersion",
  live.hint            AS "secretHint",
  live.created_at      AS "secretCreatedAt",
  COALESCE((
    SELECT json_agg(json_build_object(
             'unit', p.unit,
             'priceMicros', p.price_micros::text,
             'effectiveFrom', p.effective_from
           ) ORDER BY p.unit)
      FROM vendor_service_prices p
     WHERE p.service_id = s.id
       AND p.effective_from <= NOW()
       -- Действующая цена по каждой мере одна: та, что вступила в силу
       -- последней. Прошлые остаются в таблице ради прошлых списаний.
       AND p.effective_from = (
             SELECT MAX(p2.effective_from) FROM vendor_service_prices p2
              WHERE p2.service_id = p.service_id AND p2.unit = p.unit
                AND p2.effective_from <= NOW()
           )
  ), '[]'::json) AS prices,
  COALESCE((
    SELECT SUM(u.cents) FROM vendor_usage u
     WHERE u.service_id = s.id
       AND u.created_at > NOW() - INTERVAL '30 days'
  ), 0)::text AS "spentMonthCents"
`

/** Старшая живая версия секрета — её и показываем, её же и выдаём машинам. */
const LIVE_SECRET_JOIN = `
  LEFT JOIN LATERAL (
    SELECT sec.version, sec.hint, sec.created_at, sec.ciphertext
      FROM vendor_service_secrets sec
     WHERE sec.service_id = s.id AND sec.revoked_at IS NULL
     ORDER BY sec.version DESC
     LIMIT 1
  ) live ON TRUE
`

function toService(row: ServiceRow): VendorService {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adapter: row.adapter,
    billingModel: row.billingModel,
    currency: row.currency,
    delivery: row.delivery,
    keyTtlSec: row.keyTtlSec,
    dailyCapCents: Number(row.dailyCapCents),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    secret:
      row.secretVersion == null
        ? null
        : {
            version: row.secretVersion,
            hint: row.secretHint ?? "",
            createdAt: row.secretCreatedAt ?? row.createdAt,
          },
    prices: (row.prices ?? []).map((p) => ({
      unit: p.unit,
      priceMicros: Number(p.priceMicros),
      effectiveFrom: new Date(p.effectiveFrom),
    })),
    spentMonthCents: Number(row.spentMonthCents),
  }
}

/** Платформенные сервисы: те, что заведены нами, а не привязаны к человеку. */
export async function listServices(): Promise<VendorService[]> {
  const result = await query<ServiceRow>(
    `SELECT ${SERVICE_FIELDS}
       FROM vendor_services s
       ${LIVE_SECRET_JOIN}
      WHERE s.owner_user_id IS NULL
      ORDER BY (s.status = 'active') DESC, s.name ASC`,
  )
  return result.rows.map(toService)
}

export async function findService(id: string): Promise<VendorService | null> {
  const result = await query<ServiceRow>(
    `SELECT ${SERVICE_FIELDS}
       FROM vendor_services s
       ${LIVE_SECRET_JOIN}
      WHERE s.id = $1`,
    [id],
  )
  const row = result.rows[0]
  return row ? toService(row) : null
}

// ─── Правки ──────────────────────────────────────────────────────────────────

export type CreateServiceInput = {
  slug: string
  name: string
  adapter: string
  billingModel: VendorBillingModel
  currency: string
  delivery: VendorDelivery
  keyTtlSec: number
  dailyCapCents: number
  /** Ключ вендора. Шифруется здесь и наружу больше не выходит. */
  secret: string
  createdBy: string
}

/**
 * Завести сервис вместе с первым ключом.
 *
 * Одной транзакцией и с обязательным секретом: сервис без ключа не может
 * ничего, и его появление в списке было бы обещанием, за которым ничего нет.
 */
export async function createService(
  input: CreateServiceInput,
): Promise<{ id: string } | { conflict: "slug" }> {
  const ciphertext = encryptSecret(input.secret)
  const hint = secretHint(input.secret)

  return withTransaction(async (client) => {
    const id = randomUUID()
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vendor_services (
         id, slug, name, adapter, billing_model, currency,
         delivery, key_ttl_sec, daily_cap_cents, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        id,
        input.slug,
        input.name,
        input.adapter,
        input.billingModel,
        input.currency,
        input.delivery,
        input.keyTtlSec,
        Math.round(input.dailyCapCents),
        input.createdBy,
      ],
    )
    // Ноль строк — слаг занят. Это ответ на вопрос «можно ли так назвать», а не
    // сбой: по слагу машина просит ключ, и второй такой же увёл бы чужой.
    if (!inserted.rows[0]) return { conflict: "slug" as const }

    await client.query(
      `INSERT INTO vendor_service_secrets
         (id, service_id, version, ciphertext, hint, created_by)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [randomUUID(), id, ciphertext, hint, input.createdBy],
    )
    await bumpVaultRevision(client)
    return { id }
  })
}

export type UpdateServiceInput = {
  name?: string
  adapter?: string
  billingModel?: VendorBillingModel
  currency?: string
  delivery?: VendorDelivery
  keyTtlSec?: number
  dailyCapCents?: number
  status?: VendorStatus
}

export async function updateService(
  id: string,
  patch: UpdateServiceInput,
): Promise<boolean> {
  const sets: string[] = []
  const params: unknown[] = [id]
  const put = (column: string, value: unknown) => {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }

  if (patch.name != null) put("name", patch.name)
  if (patch.adapter != null) put("adapter", patch.adapter)
  if (patch.billingModel != null) put("billing_model", patch.billingModel)
  if (patch.currency != null) put("currency", patch.currency)
  if (patch.delivery != null) put("delivery", patch.delivery)
  if (patch.keyTtlSec != null) put("key_ttl_sec", patch.keyTtlSec)
  if (patch.dailyCapCents != null) put("daily_cap_cents", Math.round(patch.dailyCapCents))
  if (patch.status != null) put("status", patch.status)
  if (sets.length === 0) return false

  const result = await query(
    `UPDATE vendor_services
        SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = $1`,
    params,
  )

  // Ревизию двигаем на ЛЮБУЮ правку сервиса, не только на секрет: пауза, смена
  // TTL и отзыв так же обязаны доехать до машин, как новый ключ.
  if ((result.rowCount ?? 0) > 0) await bumpVaultRevision()
  return (result.rowCount ?? 0) > 0
}

/**
 * Ротация: новая версия ключа, старая остаётся живой.
 *
 * Отзывать прежнюю сразу нельзя — задачи, которые уже держат её копию, упали бы
 * посреди работы. Гасится она отдельным решением, когда парк успел обновиться.
 */
export async function rotateSecret(input: {
  serviceId: string
  secret: string
  actorId: string
}): Promise<number | null> {
  const ciphertext = encryptSecret(input.secret)
  const hint = secretHint(input.secret)

  return withTransaction(async (client) => {
    const next = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM vendor_service_secrets WHERE service_id = $1`,
      [input.serviceId],
    )
    const version = next.rows[0]?.version
    if (version == null) return null

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vendor_service_secrets
         (id, service_id, version, ciphertext, hint, created_by)
       SELECT $1, s.id, $2, $3, $4, $5 FROM vendor_services s WHERE s.id = $6
       RETURNING id`,
      [randomUUID(), version, ciphertext, hint, input.actorId, input.serviceId],
    )
    if (!inserted.rows[0]) return null

    await client.query(
      `UPDATE vendor_services SET updated_at = NOW() WHERE id = $1`,
      [input.serviceId],
    )
    await bumpVaultRevision(client)
    return version
  })
}

/** Погасить все прежние версии, оставив старшую. Делается осознанно, руками. */
export async function revokeOldSecrets(serviceId: string): Promise<number> {
  const result = await query(
    `UPDATE vendor_service_secrets
        SET revoked_at = NOW()
      WHERE service_id = $1
        AND revoked_at IS NULL
        AND version < (
          SELECT MAX(version) FROM vendor_service_secrets WHERE service_id = $1
        )`,
    [serviceId],
  )
  if ((result.rowCount ?? 0) > 0) await bumpVaultRevision()
  return result.rowCount ?? 0
}

export async function addPrice(input: {
  serviceId: string
  unit: PriceUnit
  priceMicros: number
  effectiveFrom?: Date | null
  actorId: string
}): Promise<void> {
  await query(
    `INSERT INTO vendor_service_prices
       (id, service_id, unit, price_micros, effective_from, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6)`,
    [
      randomUUID(),
      input.serviceId,
      input.unit,
      Math.round(input.priceMicros),
      input.effectiveFrom ?? null,
      input.actorId,
    ],
  )
}

// ─── Выдача машинам ──────────────────────────────────────────────────────────

export type IssuedKey = {
  slug: string
  version: number
  secret: string
  /** Сколько копия имеет право жить в сейфе на машине. */
  ttlSec: number
}

export type KeyIssue = {
  issued: IssuedKey[]
  /** Слаги, по которым у машины уже актуальная версия. */
  fresh: string[]
  /** Слаги, которых нет, они на паузе или отозваны. */
  unavailable: string[]
  revision: number
}

/**
 * Ключи для машины: только то, что ей действительно нужно обновить.
 *
 * Машина присылает известные ей версии. Совпало — отвечаем «актуально» и не
 * достаём секрет вовсе: так обычный запрос перед задачей не превращается в
 * раздачу ключей, а в журнал попадает только настоящая выдача.
 *
 * `proxy`-сервисы не выдаются никогда: их ключ не покидает сервер по решению
 * админа, и обойти это через машинный API нельзя.
 */
export async function issueKeysForMachine(input: {
  slugs: string[]
  known: Record<string, number>
}): Promise<KeyIssue> {
  const revision = await readVaultRevision()
  if (input.slugs.length === 0) {
    return { issued: [], fresh: [], unavailable: [], revision }
  }

  const result = await query<{
    slug: string
    status: VendorStatus
    delivery: VendorDelivery
    keyTtlSec: number
    version: number | null
    ciphertext: string | null
  }>(
    `SELECT s.slug,
            s.status,
            s.delivery,
            s.key_ttl_sec AS "keyTtlSec",
            live.version,
            live.ciphertext
       FROM vendor_services s
       ${LIVE_SECRET_JOIN}
      WHERE s.slug = ANY($1::text[])
        AND s.owner_user_id IS NULL`,
    [input.slugs],
  )

  const issued: IssuedKey[] = []
  const fresh: string[] = []

  for (const row of result.rows) {
    if (
      row.status !== "active" ||
      row.delivery !== "keys" ||
      row.version == null ||
      row.ciphertext == null
    ) {
      continue
    }
    if (input.known[row.slug] === row.version) {
      fresh.push(row.slug)
      continue
    }
    issued.push({
      slug: row.slug,
      version: row.version,
      secret: decryptSecret(row.ciphertext),
      ttlSec: row.keyTtlSec,
    })
  }

  // Не выданные и не подтверждённые: нет такого сервиса, он на паузе, отозван
  // или помечен `proxy`. Машина должна увидеть это явно, а не гадать по пустому
  // ответу — иначе задача пойдёт в работу без ключа и упадёт у вендора.
  const unavailable = input.slugs.filter(
    (slug) => !fresh.includes(slug) && !issued.some((k) => k.slug === slug),
  )

  return { issued, fresh, unavailable, revision }
}
