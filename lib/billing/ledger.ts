import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { query, withTransaction } from "@/lib/db"
import {
  breakdownTotal,
  type ChargeBreakdown,
  type ChargeTerms,
  type TxKind,
  type Wallet,
} from "@/lib/billing/types"

/**
 * Лента транзакций — единственный источник правды по деньгам. Остатки в
 * `users.balance_own_cents` / `balance_gift_cents` это КЭШ суммы, а не
 * самостоятельное значение: они пишутся той же транзакцией, что и строка ленты,
 * поэтому разойтись с историей не могут.
 *
 * Резерва под задачу здесь нет: лента — состоявшиеся движения, а резерв живёт на
 * самой задаче (lib/billing/funds.ts). Строка-резерв пережила бы удаление задачи
 * и заморозила бы деньги навсегда.
 */

export type TxInput = {
  userId: string
  wallet: Wallet
  kind: TxKind
  /** Знак значим: + приход, − расход. У exempt и writeoff движения нет, здесь 0. */
  amountCents: number
  projectId?: string | null
  taskId?: string | null
  grantId?: string | null
  breakdown?: ChargeBreakdown | null
  terms?: ChargeTerms | null
  actorUserId?: string | null
  comment?: string
}

export type TxRecord = {
  id: string
  userId: string
  projectId: string | null
  taskId: string | null
  wallet: Wallet
  grantId: string | null
  kind: TxKind
  amountCents: number
  ourCents: number
  vendorCents: number
  marginCents: number
  comment: string
  createdAt: Date
}

const TX_FIELDS = `
  id,
  user_id      AS "userId",
  project_id   AS "projectId",
  task_id      AS "taskId",
  wallet,
  grant_id     AS "grantId",
  kind,
  amount_cents::text  AS "amountCents",
  our_cents::text     AS "ourCents",
  vendor_cents::text  AS "vendorCents",
  margin_cents::text  AS "marginCents",
  comment,
  created_at   AS "createdAt"
`

type RawTx = Omit<
  TxRecord,
  "amountCents" | "ourCents" | "vendorCents" | "marginCents"
> & {
  amountCents: string
  ourCents: string
  vendorCents: string
  marginCents: string
}

function toRecord(row: RawTx): TxRecord {
  return {
    ...row,
    amountCents: Number(row.amountCents),
    ourCents: Number(row.ourCents),
    vendorCents: Number(row.vendorCents),
    marginCents: Number(row.marginCents),
  }
}

const BALANCE_COLUMN: Record<Wallet, string> = {
  own: "balance_own_cents",
  gift: "balance_gift_cents",
}

/**
 * Записать движение и подвинуть кэш остатка одной транзакцией.
 *
 * `client` передаётся, когда движение — часть большей работы (списание вместе с
 * закрытием гранта). Без него открывается своя транзакция.
 */
export async function recordTransaction(
  input: TxInput,
  client?: PoolClient,
): Promise<TxRecord> {
  const run = async (c: PoolClient): Promise<TxRecord> => {
    const b = input.breakdown
    const t = input.terms
    const result = await c.query<RawTx>(
      `INSERT INTO billing_transactions (
         id, user_id, project_id, task_id, wallet, grant_id, kind, amount_cents,
         our_cents, vendor_cents, margin_cents,
         vendor_currency, vendor_rate, vendor_rate_src,
         pay_base, pay_meter, units, unit_rate_cents, margin_pct,
         actor_user_id, comment
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING ${TX_FIELDS}`,
      [
        randomUUID(),
        input.userId,
        input.projectId ?? null,
        input.taskId ?? null,
        input.wallet,
        input.grantId ?? null,
        input.kind,
        Math.round(input.amountCents),
        b ? Math.round(b.ourCents) : 0,
        b ? Math.round(b.vendorCents) : 0,
        b ? Math.round(b.marginCents) : 0,
        t?.vendorCurrency ?? null,
        t?.vendorRate ?? null,
        t?.vendorRateSource ?? null,
        t?.base ?? null,
        t?.meter ?? null,
        t?.units ?? null,
        t?.unitRateCents ?? null,
        t?.marginPct ?? null,
        input.actorUserId ?? null,
        input.comment ?? "",
      ],
    )

    // Кэш двигаем только при реальном движении: exempt и writeoff несут
    // раскладку, но денег не трогают.
    if (input.amountCents !== 0) {
      await c.query(
        `UPDATE users
            SET ${BALANCE_COLUMN[input.wallet]} = ${BALANCE_COLUMN[input.wallet]} + $2
          WHERE id = $1`,
        [input.userId, Math.round(input.amountCents)],
      )
    }

    return toRecord(result.rows[0]!)
  }

  return client ? run(client) : withTransaction(run)
}

/**
 * Списание уже есть по этой задаче?
 *
 * Уникальный индекс не даст вставить второе, но узнать заранее дешевле, чем
 * ловить конфликт: до строки успело бы дойти и обновление кэша.
 */
export async function hasChargeForTask(taskId: string): Promise<boolean> {
  const result = await query<{ one: number }>(
    `SELECT 1 AS one
       FROM billing_transactions
      WHERE task_id = $1 AND kind IN ('charge', 'exempt')
      LIMIT 1`,
    [taskId],
  )
  return result.rowCount === 1
}

export type Balances = { own: number; gift: number }

/** Остатки из кэша — то, что показывается и по чему считается допуск. */
export async function readBalances(userId: string): Promise<Balances> {
  const result = await query<{ own: string; gift: string }>(
    `SELECT COALESCE(balance_own_cents, 0)::text  AS own,
            COALESCE(balance_gift_cents, 0)::text AS gift
       FROM users WHERE id = $1`,
    [userId],
  )
  const row = result.rows[0]
  return { own: Number(row?.own ?? 0), gift: Number(row?.gift ?? 0) }
}

/**
 * Пересчитать кэш из ленты и вернуть расхождение.
 *
 * Кэш и лента пишутся одной транзакцией, поэтому разойтись они не должны — и
 * именно поэтому проверка нужна: расхождение означает, что кто-то тронул
 * баланс в обход этого файла, и узнать об этом надо раньше, чем по жалобе.
 */
export async function reconcileBalances(userId: string): Promise<{
  cached: Balances
  actual: Balances
  drift: Balances
}> {
  const cached = await readBalances(userId)
  const result = await query<{ wallet: Wallet; sum: string }>(
    `SELECT wallet, COALESCE(SUM(amount_cents), 0)::text AS sum
       FROM billing_transactions
      WHERE user_id = $1
      GROUP BY wallet`,
    [userId],
  )
  const actual: Balances = { own: 0, gift: 0 }
  for (const row of result.rows) actual[row.wallet] = Number(row.sum)

  if (actual.own !== cached.own || actual.gift !== cached.gift) {
    await query(
      `UPDATE users
          SET balance_own_cents = $2, balance_gift_cents = $3
        WHERE id = $1`,
      [userId, actual.own, actual.gift],
    )
  }

  return {
    cached,
    actual,
    drift: { own: actual.own - cached.own, gift: actual.gift - cached.gift },
  }
}

export async function listTransactions(input: {
  userId?: string
  projectId?: string
  limit?: number
}): Promise<TxRecord[]> {
  const conditions: string[] = []
  const params: unknown[] = []
  if (input.userId) {
    params.push(input.userId)
    conditions.push(`user_id = $${params.length}`)
  }
  if (input.projectId) {
    params.push(input.projectId)
    conditions.push(`project_id = $${params.length}`)
  }
  params.push(Math.min(Math.max(input.limit ?? 100, 1), 500))

  const result = await query<RawTx>(
    `SELECT ${TX_FIELDS}
       FROM billing_transactions
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  )
  return result.rows.map(toRecord)
}

/**
 * Разделить стоимость работы на «оплачено» и «съели сами», когда кошелька не
 * хватило.
 *
 * Порядок поглощения — маржа, затем наша цена, и в последнюю очередь
 * себестоимость. Так и есть по смыслу: сначала мы теряем свой заработок, а
 * деньги, реально отданные внешнему сервису, — последнее, что мы согласны
 * потерять. Обратный порядок показывал бы в отчёте, что вендор нам ничего не
 * стоил, хотя платёж состоялся.
 */
export function splitShortfall(
  full: ChargeBreakdown,
  coveredCents: number,
): { paid: ChargeBreakdown; absorbed: ChargeBreakdown } {
  const total = breakdownTotal(full)
  const covered = Math.max(0, Math.min(Math.round(coveredCents), total))
  let shortfall = total - covered

  const take = (value: number) => {
    const taken = Math.min(value, shortfall)
    shortfall -= taken
    return taken
  }

  const absorbed: ChargeBreakdown = {
    marginCents: take(full.marginCents),
    ourCents: take(full.ourCents),
    vendorCents: take(full.vendorCents),
  }

  return {
    paid: {
      ourCents: full.ourCents - absorbed.ourCents,
      vendorCents: full.vendorCents - absorbed.vendorCents,
      marginCents: full.marginCents - absorbed.marginCents,
    },
    absorbed,
  }
}
