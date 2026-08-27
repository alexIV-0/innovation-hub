import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import { recordTransaction } from "@/lib/billing/ledger"
import type { GrantKind, GrantRecord, GrantStatus } from "@/lib/billing/types"

/**
 * Подарки: тестовый период и адресные начисления.
 *
 * Деньги появляются на кошельке НЕ в момент создания строки гранта, а в момент
 * активации — вместе со статусом `active`. Иначе у пользователя был бы баланс,
 * которым нельзя воспользоваться: пробные проекты ещё копируются, тратить не на
 * что, а число в кабинете уже показано.
 *
 * «Один тестовый период на человека» держит частичный уникальный индекс, а не
 * код: строка переживает удаление проектов, архив и корзину.
 */

const GRANT_FIELDS = `
  id,
  user_id      AS "userId",
  kind,
  amount_cents::float8 AS "amountCents",
  status,
  expires_at   AS "expiresAt",
  granted_by   AS "grantedBy",
  comment,
  provision_job_id AS "provisionJobId",
  closed_at    AS "closedAt",
  created_at   AS "createdAt"
`

export async function findGrant(id: string): Promise<GrantRecord | null> {
  const result = await query<GrantRecord>(
    `SELECT ${GRANT_FIELDS} FROM billing_grants WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findTrialGrant(userId: string): Promise<GrantRecord | null> {
  const result = await query<GrantRecord>(
    `SELECT ${GRANT_FIELDS}
       FROM billing_grants
      WHERE user_id = $1 AND kind = 'trial'`,
    [userId],
  )
  return result.rows[0] ?? null
}

export async function listGrantsFor(userId: string): Promise<GrantRecord[]> {
  const result = await query<GrantRecord>(
    `SELECT ${GRANT_FIELDS}
       FROM billing_grants
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows
}

export type CreateGrantInput = {
  userId: string
  kind: GrantKind
  amountCents: number
  /** null — бессрочный. Срок хранится в гранте, а не в настройке: настройка
   * меняется, выданный подарок — нет. */
  lifetimeDays?: number | null
  /** Проекты, в которых подарок действует. Пустой список — в любом. */
  projectIds?: string[]
  grantedBy?: string | null
  comment?: string
  /**
   * Начислить деньги сразу. Для адресного подарка — да, тратить есть где.
   * Для тестового периода — нет: сначала копируются проекты.
   */
  activateNow: boolean
}

export async function createGrant(input: CreateGrantInput): Promise<GrantRecord | null> {
  return withTransaction(async (client) => {
    const id = randomUUID()
    const status: GrantStatus = input.activateNow ? "active" : "provisioning"

    const inserted = await client.query<GrantRecord>(
      `INSERT INTO billing_grants (
         id, user_id, kind, amount_cents, status, expires_at, granted_by, comment
       )
       VALUES ($1, $2, $3, $4, $5,
               CASE WHEN $6::int IS NULL THEN NULL
                    ELSE NOW() + ($6::int || ' days')::interval END,
               $7, $8)
       ON CONFLICT DO NOTHING
       RETURNING ${GRANT_FIELDS}`,
      [
        id,
        input.userId,
        input.kind,
        Math.round(input.amountCents),
        status,
        input.lifetimeDays ?? null,
        input.grantedBy ?? null,
        input.comment ?? "",
      ],
    )

    // Ноль строк — сработал уникальный индекс: тестовый период у человека уже
    // был. Это не ошибка вызова, а ответ на вопрос «можно ли ещё раз».
    const grant = inserted.rows[0]
    if (!grant) return null

    for (const projectId of input.projectIds ?? []) {
      await client.query(
        `INSERT INTO billing_grant_projects (grant_id, project_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [grant.id, projectId],
      )
    }

    if (input.activateNow) {
      await creditGrant(client, grant, input.comment ?? "")
    }

    return grant
  })
}

/** Начислить деньги подарка на подарочный кошелёк. */
async function creditGrant(
  client: PoolClient,
  grant: GrantRecord,
  comment: string,
): Promise<void> {
  await recordTransaction(
    {
      userId: grant.userId,
      wallet: "gift",
      grantId: grant.id,
      kind: "grant",
      amountCents: Math.round(grant.amountCents),
      actorUserId: grant.grantedBy,
      comment,
    },
    client,
  )
}

/**
 * Перевести грант в рабочее состояние: начислить деньги и открыть его для трат.
 *
 * Идемпотентно по статусу: повторный вызов на уже активном гранте не начислит
 * второй раз. Важно, потому что работа провижининга может быть перезапущена.
 */
export async function activateGrant(input: {
  grantId: string
  projectIds: string[]
  comment?: string
}): Promise<GrantRecord | null> {
  return withTransaction(async (client) => {
    const updated = await client.query<GrantRecord>(
      `UPDATE billing_grants
          SET status = 'active', updated_at = NOW()
        WHERE id = $1 AND status = 'provisioning'
        RETURNING ${GRANT_FIELDS}`,
      [input.grantId],
    )
    const grant = updated.rows[0]
    if (!grant) return null

    for (const projectId of input.projectIds) {
      await client.query(
        `INSERT INTO billing_grant_projects (grant_id, project_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [grant.id, projectId],
      )
    }

    await creditGrant(client, grant, input.comment ?? "Тестовый период")
    return grant
  })
}

/**
 * Закрыть грант и погасить остаток.
 *
 * Зовётся, когда остатка не хватает даже на минимальный кусок работы или когда
 * истёк срок. Остаток гасим строкой, а не обнулением поля: висящие двенадцать
 * рублей, на которые ничего не купить, — это непонятная строка в кабинете, а
 * молча стёртые деньги — дыра в ленте.
 */
export async function closeGrant(input: {
  grantId: string
  status: Extract<GrantStatus, "exhausted" | "expired" | "revoked">
  remainingCents: number
  actorUserId?: string | null
  comment?: string
}): Promise<void> {
  await withTransaction(async (client) => {
    const updated = await client.query<GrantRecord>(
      `UPDATE billing_grants
          SET status = $2, closed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING ${GRANT_FIELDS}`,
      [input.grantId, input.status],
    )
    const grant = updated.rows[0]
    if (!grant) return

    if (input.remainingCents > 0) {
      await recordTransaction(
        {
          userId: grant.userId,
          wallet: "gift",
          grantId: grant.id,
          kind: "adjust",
          amountCents: -Math.round(input.remainingCents),
          actorUserId: input.actorUserId ?? null,
          comment: input.comment ?? `Остаток погашен: ${input.status}`,
        },
        client,
      )
    }
  })
}
