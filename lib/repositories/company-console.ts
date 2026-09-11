import { query } from "@/lib/db"
import type { CompanyRole } from "@/lib/domain-types"

/**
 * Выборки консоли компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА: `companyId` — обязательный первый аргумент
 * каждой функции, и он всегда попадает в `WHERE`. Это единственное место в
 * коде, которое смотрит поперёк нескольких человек (§2), поэтому забытый фильтр
 * здесь означал бы, что админ одной компании видит людей другой.
 *
 * Функции намеренно не принимают «необязательный» companyId и не имеют
 * умолчаний: значение приходит из гейта (lib/company-auth.ts), который без него
 * не возвращается.
 *
 * Денег здесь нет: остаток и резерв компании считает `getFunds(walletUserId)`
 * из lib/billing/funds.ts. Свой запрос был бы вторым ответом на вопрос «сколько
 * доступно» — и разошёлся бы с тем, по которому работает допуск задач
 * (`liveReserves` учитывает статус `claimed`, окно досчёта у завершённых и
 * разделение кошельков; наивная сумма по `queued/running` этого не знает).
 */

export type CompanyPerson = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
  isActive: boolean
  createdAt: Date
}

export async function listPeople(companyId: string): Promise<CompanyPerson[]> {
  const result = await query<CompanyPerson>(
    `SELECT id AS "userId",
            email,
            COALESCE(full_name, '') AS "fullName",
            company_role AS "companyRole",
            is_active AS "isActive",
            created_at AS "createdAt"
       FROM users
      WHERE company_id = $1
        AND kind = 'person'
      ORDER BY
        CASE company_role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        lower(COALESCE(NULLIF(full_name, ''), email))`,
    [companyId],
  )
  return result.rows
}

/**
 * Роль человека в ЭТОЙ компании. `null` — он не её сотрудник.
 *
 * Нужна перед каждым изменением: без неё «сменить роль» принимало бы чужой
 * идентификатор и меняло человека в соседней компании.
 */
export async function readMemberRole(
  companyId: string,
  userId: string,
): Promise<CompanyRole | null> {
  const result = await query<{ companyRole: CompanyRole }>(
    `SELECT company_role AS "companyRole"
       FROM users
      WHERE id = $1 AND company_id = $2 AND kind = 'person'`,
    [userId, companyId],
  )
  return result.rows[0]?.companyRole ?? null
}

export async function setMemberRole(input: {
  companyId: string
  userId: string
  companyRole: CompanyRole
}): Promise<boolean> {
  const result = await query(
    `UPDATE users
        SET company_role = $3, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND kind = 'person'`,
    [input.userId, input.companyId, input.companyRole],
  )
  return (result.rowCount ?? 0) > 0
}

export type CompanyLedgerRow = {
  id: string
  kind: string
  wallet: string
  amountCents: number
  comment: string
  createdAt: Date
  projectName: string | null
  /** Чья работа: компания платит за многих, и «кто потратил» — первый вопрос. */
  spenderName: string | null
}

/**
 * Лента кошелька компании.
 *
 * «Кто потратил» берётся через владельца проекта, а не отдельной колонкой:
 * связь `billing_transactions.project_id → projects.user_id` уже есть, а
 * `spender_user_id` был бы вторым источником правды (план §7.9). Проект удалён
 * (`ON DELETE SET NULL`) — строка остаётся без имени, и это честнее, чем
 * подставить чужое.
 */
export async function listCompanyLedger(input: {
  walletUserId: string
  limit: number
  before?: string | null
}): Promise<{ rows: CompanyLedgerRow[]; nextCursor: string | null }> {
  const params: unknown[] = [input.walletUserId]
  let cursor = ""
  if (input.before) {
    params.push(input.before)
    cursor = `AND b.created_at < (SELECT created_at FROM billing_transactions WHERE id = $${params.length})`
  }
  params.push(input.limit + 1)

  const result = await query<CompanyLedgerRow & { amountCents: string }>(
    `SELECT b.id,
            b.kind,
            b.wallet,
            b.amount_cents::text AS "amountCents",
            b.comment,
            b.created_at AS "createdAt",
            p.name AS "projectName",
            COALESCE(NULLIF(u.contact_name, ''), NULLIF(u.full_name, ''), u.email)
              AS "spenderName"
       FROM billing_transactions b
       LEFT JOIN projects p ON p.id = b.project_id
       LEFT JOIN users u ON u.id = p.user_id
      WHERE b.user_id = $1
        ${cursor}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT $${params.length}`,
    params,
  )

  const all = result.rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
  }))
  const hasMore = all.length > input.limit
  const rows = hasMore ? all.slice(0, input.limit) : all
  return {
    rows,
    nextCursor: hasMore ? (rows[rows.length - 1]?.id ?? null) : null,
  }
}

export type CompanyKeyRow = {
  accountId: string
  label: string
  serviceSlug: string
  serviceTitle: string
  status: string
  createdAt: Date
}

/**
 * Учётки внешних сервисов компании — те, чей владелец её служебный кошелёк
 * (план §11). Ключи не отдаются никогда: только метки, как и сотруднику при
 * настройке узла.
 */
export async function listCompanyKeys(
  walletUserId: string,
): Promise<CompanyKeyRow[]> {
  const result = await query<CompanyKeyRow>(
    `SELECT a.id AS "accountId",
            a.label,
            s.slug AS "serviceSlug",
            s.name AS "serviceTitle",
            a.status,
            a.created_at AS "createdAt"
       FROM vendor_accounts a
       JOIN vendor_services s ON s.id = a.service_id
      WHERE a.owner_user_id = $1
      ORDER BY s.name, a.label`,
    [walletUserId],
  )
  return result.rows
}

/** Кого компания оплачивает: сотрудники, у которых плательщик — её кошелёк. */
export async function listCompanyPayees(
  walletUserId: string,
): Promise<{ userId: string; email: string; fullName: string }[]> {
  const result = await query<{ userId: string; email: string; fullName: string }>(
    `SELECT id AS "userId", email, COALESCE(full_name, '') AS "fullName"
       FROM users
      WHERE payer_user_id = $1
      ORDER BY lower(COALESCE(NULLIF(full_name, ''), email))`,
    [walletUserId],
  )
  return result.rows
}
