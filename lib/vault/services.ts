import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import {
  decryptFields,
  encryptFields,
  fieldsHint,
  type SecretFields,
} from "@/lib/vault/crypto"
import { DEFAULT_SECRET_FIELDS, isMissingTable } from "@/lib/vault/types"
import type {
  PriceUnit,
  SecretFieldSpec,
  VendorAccount,
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

/** Учётка как её отдаёт json_agg: даты строками, деньги текстом. */
type AccountRow = {
  id: string
  serviceId: string
  label: string
  ownerUserId: string | null
  ownerEmail: string | null
  status: VendorStatus
  createdAt: string
  updatedAt: string
  secretVersion: number | null
  secretHint: string | null
  secretCreatedAt: string | null
  spentMonthCents: string
}

type ServiceRow = Omit<
  VendorService,
  "dailyCapCents" | "spentMonthCents" | "accounts" | "prices" | "secretFields"
> & {
  dailyCapCents: string
  spentMonthCents: string
  secretFields: SecretFieldSpec[] | null
  accounts: AccountRow[] | null
  prices: { unit: PriceUnit; priceMicros: string; effectiveFrom: string }[] | null
}

/**
 * Старшая живая версия секрета УЧЁТКИ — её показываем и её же выдаём машинам.
 *
 * Живых версий может быть несколько: на время ротации это норма, иначе задачи,
 * уже держащие прежнюю копию, упали бы посреди работы.
 */
const LIVE_ACCOUNT_SECRET = `
  LEFT JOIN LATERAL (
    SELECT sec.version, sec.hint, sec.created_at, sec.ciphertext
      FROM vendor_account_secrets sec
     WHERE sec.account_id = a.id AND sec.revoked_at IS NULL
     ORDER BY sec.version DESC
     LIMIT 1
  ) live ON TRUE
`

const SERVICE_FIELDS = `
  s.id,
  s.slug,
  s.name,
  s.adapter,
  s.base_url           AS "baseUrl",
  s.billing_model      AS "billingModel",
  s.currency,
  s.delivery,
  s.key_ttl_sec        AS "keyTtlSec",
  s.daily_cap_cents::text AS "dailyCapCents",
  s.status,
  s.created_at         AS "createdAt",
  s.updated_at         AS "updatedAt",
  s.secret_fields      AS "secretFields",
  -- Учётки со своими живыми секретами и своим расходом. Подзапросом, как и
  -- прайс: сервисов на экране единицы, а join размножил бы строки сервиса на
  -- число учёток, и собирать их обратно пришлось бы в коде.
  COALESCE((
    SELECT json_agg(json_build_object(
             'id', a.id,
             'serviceId', a.service_id,
             'label', a.label,
             'ownerUserId', a.owner_user_id,
             'ownerEmail', ou.email,
             'status', a.status,
             'createdAt', a.created_at,
             'updatedAt', a.updated_at,
             'secretVersion', live.version,
             'secretHint', live.hint,
             'secretCreatedAt', live.created_at,
             'spentMonthCents', COALESCE((
               SELECT SUM(u.cents) FROM vendor_usage u
                WHERE u.account_id = a.id
                  AND u.created_at > NOW() - INTERVAL '30 days'
             ), 0)::text
           ) ORDER BY a.label)
      FROM vendor_accounts a
      LEFT JOIN users ou ON ou.id = a.owner_user_id
      ${LIVE_ACCOUNT_SECRET}
     WHERE a.service_id = s.id
  ), '[]'::json) AS accounts,
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

function toAccount(row: AccountRow): VendorAccount {
  return {
    id: row.id,
    serviceId: row.serviceId,
    label: row.label,
    ownerUserId: row.ownerUserId,
    ownerEmail: row.ownerEmail,
    status: row.status,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    secret:
      row.secretVersion == null
        ? null
        : {
            version: row.secretVersion,
            hint: row.secretHint ?? "",
            createdAt: new Date(row.secretCreatedAt ?? row.createdAt),
          },
    spentMonthCents: Number(row.spentMonthCents),
  }
}

function toService(row: ServiceRow): VendorService {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    adapter: row.adapter,
    baseUrl: row.baseUrl,
    billingModel: row.billingModel,
    currency: row.currency,
    delivery: row.delivery,
    keyTtlSec: row.keyTtlSec,
    dailyCapCents: Number(row.dailyCapCents),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // Пустой массив в базе означает «состав по умолчанию»: заводить запись про
    // единственный `apiKey` в каждом сервисе незачем.
    secretFields:
      row.secretFields && row.secretFields.length > 0
        ? row.secretFields
        : DEFAULT_SECRET_FIELDS,
    accounts: (row.accounts ?? []).map(toAccount),
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
      WHERE s.owner_user_id IS NULL
      ORDER BY (s.status = 'active') DESC, s.name ASC`,
  )
  return result.rows.map(toService)
}

export async function findService(id: string): Promise<VendorService | null> {
  const result = await query<ServiceRow>(
    `SELECT ${SERVICE_FIELDS}
       FROM vendor_services s
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
  /** Адрес сервиса. Пусто — адрес знает нода. */
  baseUrl: string
  billingModel: VendorBillingModel
  currency: string
  delivery: VendorDelivery
  keyTtlSec: number
  dailyCapCents: number
  /** Из чего состоит секрет учётки. Пусто — одно поле `apiKey`. */
  secretFields: SecretFieldSpec[]
  /**
   * Первая учётка, если она уже известна. Пусто — сервис заводится без учёток:
   * законный случай для своего сервиса, поднятого рядом, которому авторизация
   * не нужна вовсе.
   */
  account: { label: string; fields: SecretFields } | null
  createdBy: string
}

/**
 * Завести сервис и, если ключ уже известен, первую учётку к нему.
 *
 * Одной транзакцией: сервис, появившийся без обещанной учётки, пришлось бы
 * дозаводить вторым действием, и между ними он лежал бы в списке пустым.
 */
export async function createService(
  input: CreateServiceInput,
): Promise<{ id: string } | { conflict: "slug" }> {
  // Шифруем ДО транзакции и только если учётка задана: сервис без авторизации —
  // законный случай (свой ComfyUI рядом). Заводить ему пустую учётку нельзя:
  // она выглядела бы как настоящая и уехала бы на машину, где вендор отверг бы
  // её как неверную.
  const primary = (input.secretFields[0] ?? DEFAULT_SECRET_FIELDS[0]!).key
  const ciphertext = input.account ? encryptFields(input.account.fields) : null
  const hint = input.account ? fieldsHint(input.account.fields, primary) : ""

  return withTransaction(async (client) => {
    const id = randomUUID()
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vendor_services (
         id, slug, name, adapter, base_url, billing_model, currency,
         delivery, key_ttl_sec, daily_cap_cents, secret_fields, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
      [
        id,
        input.slug,
        input.name,
        input.adapter,
        input.baseUrl,
        input.billingModel,
        input.currency,
        input.delivery,
        input.keyTtlSec,
        Math.round(input.dailyCapCents),
        JSON.stringify(input.secretFields),
        input.createdBy,
      ],
    )
    // Ноль строк — слаг занят. Это ответ на вопрос «можно ли так назвать», а не
    // сбой: по слагу машина просит ключ, и второй такой же увёл бы чужой.
    if (!inserted.rows[0]) return { conflict: "slug" as const }

    if (ciphertext && input.account) {
      const accountId = randomUUID()
      await client.query(
        `INSERT INTO vendor_accounts (id, service_id, label, created_by)
         VALUES ($1, $2, $3, $4)`,
        [accountId, id, input.account.label, input.createdBy],
      )
      await client.query(
        `INSERT INTO vendor_account_secrets
           (id, account_id, version, ciphertext, hint, created_by)
         VALUES ($1, $2, 1, $3, $4, $5)`,
        [randomUUID(), accountId, ciphertext, hint, input.createdBy],
      )
    }
    await bumpVaultRevision(client)
    return { id }
  })
}

export type UpdateServiceInput = {
  name?: string
  adapter?: string
  baseUrl?: string
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
  if (patch.baseUrl != null) put("base_url", patch.baseUrl)
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

// ─── Учётки ──────────────────────────────────────────────────────────────────

/**
 * Завести учётку под сервисом.
 *
 * `ownerUserId` — тот случай, ради которого учётки и появились: клиент принёс
 * свой ключ, и расход по нему не наш. NULL оставляет учётку платформенной.
 */
export async function createAccount(input: {
  serviceId: string
  label: string
  ownerUserId: string | null
  fields: SecretFields
  actorId: string
}): Promise<{ id: string } | { conflict: "label" } | null> {
  const service = await findService(input.serviceId)
  if (!service) return null

  const primary = (service.secretFields[0] ?? DEFAULT_SECRET_FIELDS[0]!).key
  const ciphertext = encryptFields(input.fields)
  const hint = fieldsHint(input.fields, primary)

  return withTransaction(async (client) => {
    const id = randomUUID()
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO vendor_accounts
         (id, service_id, label, owner_user_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (service_id, label) DO NOTHING
       RETURNING id`,
      [id, input.serviceId, input.label, input.ownerUserId, input.actorId],
    )
    // Ноль строк — метка занята. По ней ссылается поле проекта, и вторая такая
    // же сделала бы ссылку двусмысленной.
    if (!inserted.rows[0]) return { conflict: "label" as const }

    await client.query(
      `INSERT INTO vendor_account_secrets
         (id, account_id, version, ciphertext, hint, created_by)
       VALUES ($1, $2, 1, $3, $4, $5)`,
      [randomUUID(), id, ciphertext, hint, input.actorId],
    )
    await bumpVaultRevision(client)
    return { id }
  })
}

/** Пауза, отзыв и переименование учётки. Секрет сюда не входит — он ротацией. */
export async function updateAccount(
  id: string,
  patch: { label?: string; status?: VendorStatus; ownerUserId?: string | null },
): Promise<boolean> {
  const sets: string[] = []
  const params: unknown[] = [id]
  const put = (column: string, value: unknown) => {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }

  if (patch.label != null) put("label", patch.label)
  if (patch.status != null) put("status", patch.status)
  if (patch.ownerUserId !== undefined) put("owner_user_id", patch.ownerUserId)
  if (sets.length === 0) return false

  const result = await query(
    `UPDATE vendor_accounts
        SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = $1`,
    params,
  )
  if ((result.rowCount ?? 0) > 0) await bumpVaultRevision()
  return (result.rowCount ?? 0) > 0
}

/**
 * Ротация: новая версия секрета учётки, старая остаётся живой.
 *
 * Отзывать прежнюю сразу нельзя — задачи, которые уже держат её копию, упали бы
 * посреди работы. Гасится она отдельным решением, когда парк успел обновиться.
 */
export async function rotateAccountSecret(input: {
  accountId: string
  fields: SecretFields
  actorId: string
}): Promise<number | null> {
  return withTransaction(async (client) => {
    // Состав полей берём у сервиса этой учётки: подсказка должна считаться по
    // главному полю, а какое главное — знает сервис, а не учётка.
    const owner = await client.query<{ secretFields: SecretFieldSpec[] | null }>(
      `SELECT s.secret_fields AS "secretFields"
         FROM vendor_accounts a
         JOIN vendor_services s ON s.id = a.service_id
        WHERE a.id = $1`,
      [input.accountId],
    )
    const spec = owner.rows[0]
    if (!spec) return null

    const fields =
      spec.secretFields && spec.secretFields.length > 0
        ? spec.secretFields
        : DEFAULT_SECRET_FIELDS
    const ciphertext = encryptFields(input.fields)
    const hint = fieldsHint(input.fields, fields[0]!.key)

    const next = await client.query<{ version: number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM vendor_account_secrets WHERE account_id = $1`,
      [input.accountId],
    )
    const version = next.rows[0]?.version
    if (version == null) return null

    await client.query(
      `INSERT INTO vendor_account_secrets
         (id, account_id, version, ciphertext, hint, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), input.accountId, version, ciphertext, hint, input.actorId],
    )
    await client.query(
      `UPDATE vendor_accounts SET updated_at = NOW() WHERE id = $1`,
      [input.accountId],
    )
    await bumpVaultRevision(client)
    return version
  })
}

/** Погасить все прежние версии учётки, оставив старшую. Осознанно, руками. */
export async function revokeOldAccountSecrets(accountId: string): Promise<number> {
  const result = await query(
    `UPDATE vendor_account_secrets
        SET revoked_at = NOW()
      WHERE account_id = $1
        AND revoked_at IS NULL
        AND version < (
          SELECT MAX(version) FROM vendor_account_secrets WHERE account_id = $1
        )`,
    [accountId],
  )
  if ((result.rowCount ?? 0) > 0) await bumpVaultRevision()
  return result.rowCount ?? 0
}

/** Учётка вместе со своим сервисом — для роутов, которым нужен и тот и другой. */
export async function findAccountService(
  accountId: string,
): Promise<{ service: VendorService; account: VendorAccount } | null> {
  const found = await query<{ serviceId: string }>(
    `SELECT service_id AS "serviceId" FROM vendor_accounts WHERE id = $1`,
    [accountId],
  )
  const serviceId = found.rows[0]?.serviceId
  if (!serviceId) return null

  const service = await findService(serviceId)
  const account = service?.accounts.find((entry) => entry.id === accountId)
  return service && account ? { service, account } : null
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

// ─── Учётки глазами их владельца (7.1) ───────────────────────────────────────

/**
 * Учётка клиента для его собственного экрана «Мои ключи».
 *
 * Отдельный тип, а не `VendorAccount`: там учётка внутри сервиса, здесь —
 * плоский список по всем сервисам сразу. Ключ у человека один на все его
 * проекты, и искать его «в том проекте, где я его вводил» он не должен.
 *
 * Расхода здесь нет намеренно: сколько он потратил у вендора — вопрос его
 * личного кабинета у вендора, а не наш. Мы показываем, что ключ подключён.
 */
export type OwnedAccount = {
  id: string
  serviceId: string
  serviceName: string
  serviceSlug: string
  label: string
  status: VendorStatus
  createdAt: Date
  /** Только версия и подсказка. Сам секрет не отдаётся даже владельцу. */
  secret: { version: number; hint: string; createdAt: Date } | null
}

export async function listAccountsForOwner(userId: string): Promise<OwnedAccount[]> {
  const result = await query<{
    id: string
    serviceId: string
    serviceName: string
    serviceSlug: string
    label: string
    status: VendorStatus
    createdAt: Date
    secretVersion: number | null
    secretHint: string | null
    secretCreatedAt: Date | null
  }>(
    `SELECT a.id,
            a.service_id  AS "serviceId",
            s.name        AS "serviceName",
            s.slug        AS "serviceSlug",
            a.label,
            a.status,
            a.created_at  AS "createdAt",
            live.version    AS "secretVersion",
            live.hint       AS "secretHint",
            live.created_at AS "secretCreatedAt"
       FROM vendor_accounts a
       JOIN vendor_services s ON s.id = a.service_id
       ${LIVE_ACCOUNT_SECRET}
      -- Строго свои. Отсутствие этого условия означало бы, что человек видит
      -- студийные ключи — ровно то, чего экран не должен допускать никогда.
      WHERE a.owner_user_id = $1
        AND a.status <> 'revoked'
      ORDER BY s.name ASC, a.label ASC`,
    [userId],
  )

  return result.rows.map((row) => ({
    id: row.id,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    serviceSlug: row.serviceSlug,
    label: row.label,
    status: row.status,
    createdAt: row.createdAt,
    secret:
      row.secretVersion == null
        ? null
        : {
            version: row.secretVersion,
            hint: row.secretHint ?? "",
            createdAt: row.secretCreatedAt ?? row.createdAt,
          },
  }))
}

/**
 * Сервисы, к которым человек может подключить свой ключ.
 *
 * `proxy` сюда не попадает: его ключ не покидает сервер по решению админа, и
 * предлагать человеку завести такой — обещать работу, которой не будет.
 */
export type OwnedAccountService = {
  id: string
  slug: string
  name: string
  secretFields: SecretFieldSpec[]
}

export async function listServicesForOwner(): Promise<OwnedAccountService[]> {
  const result = await query<{
    id: string
    slug: string
    name: string
    secretFields: SecretFieldSpec[] | null
  }>(
    `SELECT s.id, s.slug, s.name, s.secret_fields AS "secretFields"
       FROM vendor_services s
      WHERE s.owner_user_id IS NULL
        AND s.status = 'active'
        AND s.delivery = 'keys'
      ORDER BY s.name ASC`,
  )
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    secretFields:
      row.secretFields && row.secretFields.length > 0
        ? row.secretFields
        : DEFAULT_SECRET_FIELDS,
  }))
}

/**
 * Учётка, принадлежащая ИМЕННО этому человеку.
 *
 * Владелец проверяется запросом, а не после выборки: иначе проверку однажды
 * забудут дописать в новом роуте, и чужая учётка окажется доступна по прямому
 * id. Здесь забыть нельзя — функция без владельца ничего не возвращает.
 */
export async function findOwnedAccount(
  accountId: string,
  userId: string,
): Promise<{ id: string; serviceId: string; label: string } | null> {
  const result = await query<{ id: string; serviceId: string; label: string }>(
    `SELECT id, service_id AS "serviceId", label
       FROM vendor_accounts
      WHERE id = $1 AND owner_user_id = $2`,
    [accountId, userId],
  )
  return result.rows[0] ?? null
}

// ─── Выдача машинам ──────────────────────────────────────────────────────────

export type IssuedKey = {
  slug: string
  /** Метка учётки. Она же лежит в поле проекта — не секрет и не id. */
  account: string
  version: number
  /**
   * Именованные поля секрета: `apiKey`, либо `login` + `password`, либо
   * `client_id` + `client_secret`. Объектом, а не строкой: первый же вендор с
   * парой полей сломал бы строковую схему выдачи.
   */
  fields: SecretFields
  /** Сколько копия имеет право жить в сейфе на машине. */
  ttlSec: number
}

/** Подтверждение «эта версия у тебя актуальная» — по паре учётка + слаг. */
export type FreshKey = { slug: string; account: string }

/**
 * Каталожная часть ответа: то, что не секрет.
 *
 * Отдельно от `issued`, и это принципиально. Секрет приходит ТОЛЬКО когда
 * версия у машины устарела; адрес же нужен ей всегда — в том числе когда ключ
 * не менялся и ответ по нему `fresh`. Положи мы адрес внутрь `issued`, смена
 * адреса без смены ключа до машины не доехала бы вовсе, хотя ревизия сейфа
 * выросла бы и машина честно сходила бы за обновлением.
 */
export type ServiceEndpoint = {
  slug: string
  /** Пусто — адрес знает сама нода (О5). */
  baseUrl: string
  /** Какая учётка выбрана для этого запроса. `null` — ни одной не подошло. */
  account: string | null
  /**
   * Из чего состоит секрет этого сервиса.
   *
   * Едет вместе с адресом, а не отдельным каталогом: блок `services` и так
   * приходит на каждый запрос ключей, в том числе когда секрет не менялся, —
   * транспорт уже есть. Без этого поля форма заведения учётки на машине
   * рисуется по локальному справочнику, который разъедется с нашим при первом
   * же новом вендоре.
   */
  secretFields: SecretFieldSpec[]
  /**
   * Есть ли у сервиса ключ. `false` — законное состояние, а не поломка: свой
   * сервис, поднятый рядом, может не требовать авторизации. Ноде это надо
   * знать явно, иначе отсутствие ключа она примет за сбой выдачи.
   */
  hasSecret: boolean
}

export type KeyIssue = {
  issued: IssuedKey[]
  /** Слаги, по которым у машины уже актуальная версия. */
  fresh: FreshKey[]
  /** Слаги, которых нет, они на паузе, отозваны или помечены `proxy`. */
  unavailable: string[]
  /**
   * Платформенных учёток несколько, а метка не названа. Не ошибка вызова, но и
   * не повод выбрать за ноду: `main` вместо `test` заметили бы по счёту.
   */
  ambiguous: string[]
  /** Адрес и наличие ключа по каждому доступному сервису — в любом случае. */
  services: ServiceEndpoint[]
  revision: number
}

/**
 * Владелец задачи — тот, чью учётку надо выдать (пункт 3 запроса клиента).
 *
 * Живёт здесь, а не в конвейере: спрашивает об этом только сейф, и тащить ради
 * одного запроса зависимость от `lib/pipeline` в модуль секретов незачем.
 *
 * Задачи чистятся, а ключи просят под живую задачу — не нашли, значит выдаём
 * платформенную учётку, как и без `taskId` вовсе.
 */
export async function findTaskOwner(taskId: string): Promise<string | null> {
  try {
    const result = await query<{ userId: string }>(
      `SELECT p.user_id AS "userId"
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = $1`,
      [taskId],
    )
    return result.rows[0]?.userId ?? null
  } catch (error) {
    if (isMissingTable(error)) return null
    throw error
  }
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
 *
 * ⚠️ Какую УЧЁТКУ выдать, решает сайт, а не машина (пункт 3 запроса клиента).
 * У машины выбирать не из чего: по правилу «выдаём только нужное» чужих ключей
 * на ней лежать не должно. Порядок разрешения:
 *
 *   1. нода назвала метку явно — берём её (поле проекта хранит именно метку);
 *   2. известен владелец задачи и у него есть своя учётка — берём её, тогда
 *      расход его, а не наш;
 *   3. иначе единственная платформенная.
 *
 * Если платформенных несколько и метка не названа — это `ambiguous`, а не
 * «возьмём первую попавшуюся». Выбор между `main` и `test` молча означал бы,
 * что отладочный ключ однажды уедет в боевой прогон, и заметят это по счёту.
 */
export async function issueKeysForMachine(input: {
  slugs: string[]
  /** Что уже лежит в сейфе машины: слаг → учётка и её версия. */
  known: Record<string, { account: string; version: number }>
  /** Метка, названная нодой явно: слаг → учётка. */
  accounts?: Record<string, string>
  /** Владелец задачи, под которую просят ключи. */
  ownerUserId?: string | null
}): Promise<KeyIssue> {
  const revision = await readVaultRevision()
  if (input.slugs.length === 0) {
    return {
      issued: [],
      fresh: [],
      unavailable: [],
      ambiguous: [],
      services: [],
      revision,
    }
  }

  const result = await query<{
    slug: string
    status: VendorStatus
    delivery: VendorDelivery
    baseUrl: string
    keyTtlSec: number
    secretFields: SecretFieldSpec[] | null
    accountId: string | null
    label: string | null
    ownerUserId: string | null
    version: number | null
    ciphertext: string | null
  }>(
    `SELECT s.slug,
            s.status,
            s.delivery,
            s.base_url      AS "baseUrl",
            s.key_ttl_sec   AS "keyTtlSec",
            s.secret_fields AS "secretFields",
            a.id            AS "accountId",
            a.label,
            a.owner_user_id AS "ownerUserId",
            live.version,
            live.ciphertext
       FROM vendor_services s
       LEFT JOIN vendor_accounts a
              ON a.service_id = s.id AND a.status = 'active'
       ${LIVE_ACCOUNT_SECRET}
      WHERE s.slug = ANY($1::text[])
        AND s.owner_user_id IS NULL`,
    [input.slugs],
  )

  // Строк на сервис столько, сколько у него живых учёток. Собираем обратно:
  // решение «какую учётку» принимается по всему набору сразу, а не построчно.
  const bySlug = new Map<string, typeof result.rows>()
  for (const row of result.rows) {
    if (row.status !== "active" || row.delivery !== "keys") continue
    const list = bySlug.get(row.slug)
    if (list) list.push(row)
    else bySlug.set(row.slug, [row])
  }

  const issued: IssuedKey[] = []
  const fresh: FreshKey[] = []
  const services: ServiceEndpoint[] = []
  const ambiguous: string[] = []

  for (const [slug, rows] of bySlug) {
    const first = rows[0]!
    const live = rows.filter((row) => row.accountId != null)

    const wanted = input.accounts?.[slug]
    const owned = input.ownerUserId
      ? live.find((row) => row.ownerUserId === input.ownerUserId)
      : undefined
    const platform = live.filter((row) => row.ownerUserId == null)

    const picked = wanted
      ? live.find((row) => row.label === wanted)
      : (owned ?? (platform.length === 1 ? platform[0] : undefined))

    // Метка названа, но такой живой учётки нет — это не двусмысленность, а
    // отсутствие: сервис уедет в `unavailable` ниже вместе с бесключевыми.
    if (!picked && wanted) continue
    if (!picked && platform.length > 1) ambiguous.push(slug)

    services.push({
      slug,
      baseUrl: first.baseUrl,
      account: picked?.label ?? null,
      hasSecret: picked?.version != null && picked?.ciphertext != null,
      // Пустой массив в базе означает «состав по умолчанию»: разворачиваем его
      // здесь, чтобы машине не пришлось знать про это соглашение.
      secretFields:
        first.secretFields && first.secretFields.length > 0
          ? first.secretFields
          : DEFAULT_SECRET_FIELDS,
    })

    if (!picked || picked.version == null || picked.ciphertext == null) continue

    // Свежесть — по паре «учётка + версия». Одной версии мало: у разных учёток
    // нумерация своя, и `v3` у `main` совпал бы с `v3` у `test`.
    const cached = input.known[slug]
    if (cached && cached.account === picked.label && cached.version === picked.version) {
      fresh.push({ slug, account: picked.label! })
      continue
    }

    issued.push({
      slug,
      account: picked.label!,
      version: picked.version,
      fields: decryptFields(picked.ciphertext),
      ttlSec: first.keyTtlSec,
    })
  }

  // Недоступные считаем по каталогу, а не по «не выдали ключ»: сервис без
  // ключа пригоден к работе, и попади он сюда, нода сняла бы задачу, для
  // которой всё есть. Машина должна видеть недоступность явно — иначе задача
  // пойдёт в работу без ключа и упадёт уже у вендора.
  const unavailable = input.slugs.filter(
    (slug) => !services.some((entry) => entry.slug === slug),
  )

  return { issued, fresh, unavailable, ambiguous, services, revision }
}
