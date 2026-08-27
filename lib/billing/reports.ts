import { query } from "@/lib/db"
import type { GrantStatus } from "@/lib/billing/types"

/**
 * Выборки для наблюдения в «Тарифах»: кто активировал период, какие проекты
 * входят в пробный набор, у кого не задана единица тарификации.
 *
 * Отдельно от `lib/billing/projects.ts`: там правки, здесь только чтение, и
 * запросы тут заведомо тяжелее — им место не рядом с горячим путём конвейера.
 */

export type Activation = {
  grantId: string
  userId: string
  email: string
  fullName: string
  status: GrantStatus
  amountCents: number
  remainingCents: number
  activatedAt: Date
  expiresAt: Date | null
  /** Когда человек зарегистрировался. Рядом с активацией — чтобы серия
   *  однотипных аккаунтов была видна глазом. */
  registeredAt: Date
  projectCount: number
}

export async function listTrialActivations(limit = 200): Promise<Activation[]> {
  const result = await query<
    Omit<Activation, "amountCents" | "remainingCents" | "projectCount"> & {
      amountCents: string
      remainingCents: string
      projectCount: number
    }
  >(
    `SELECT g.id                 AS "grantId",
            g.user_id            AS "userId",
            u.email,
            COALESCE(u.full_name, '') AS "fullName",
            g.status,
            g.amount_cents::text AS "amountCents",
            COALESCE((
              SELECT SUM(b.amount_cents) FROM billing_transactions b
               WHERE b.grant_id = g.id
            ), 0)::text          AS "remainingCents",
            g.created_at         AS "activatedAt",
            g.expires_at         AS "expiresAt",
            u.created_at         AS "registeredAt",
            (SELECT COUNT(*)::int FROM billing_grant_projects gp
              WHERE gp.grant_id = g.id) AS "projectCount"
       FROM billing_grants g
       JOIN users u ON u.id = g.user_id
      WHERE g.kind = 'trial'
      ORDER BY g.created_at DESC
      LIMIT $1`,
    [limit],
  )

  return result.rows.map((row) => ({
    ...row,
    amountCents: Number(row.amountCents),
    remainingCents: Number(row.remainingCents),
  }))
}

export type ProjectPick = {
  projectId: string
  name: string
  ownerEmail: string
  isTemplate: boolean
}

/**
 * Поиск проекта, чтобы отметить его шаблоном.
 *
 * По имени проекта и по почте владельца сразу: шаблоны лежат у служебного
 * аккаунта, и «показать всё, что у templates@…» — самый частый запрос здесь.
 */
export async function searchProjects(q: string, limit = 20): Promise<ProjectPick[]> {
  const term = `%${q.trim().toLowerCase()}%`
  const result = await query<ProjectPick>(
    `SELECT p.id AS "projectId",
            p.name,
            u.email AS "ownerEmail",
            COALESCE(p.is_template, FALSE) AS "isTemplate"
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE p.deleted_at IS NULL
        AND (lower(p.name) LIKE $1 OR lower(u.email) LIKE $1)
      ORDER BY COALESCE(p.is_template, FALSE) DESC, p.updated_at DESC
      LIMIT $2`,
    [term, limit],
  )
  return result.rows
}

export type TemplateCost = {
  projectId: string
  /**
   * Во что фактически обошлась секунда результата по последним обработкам.
   *
   * Из неё назначается размер подарка: обещание «100 минут за 6 000 ₽» правдиво
   * только если минута наших шаблонов действительно столько стоит. Ставка сайта
   * на этот вопрос не отвечает — она лишь часть цены.
   */
  centsPerSec: number | null
  charges: number
}

export async function listTemplateCosts(
  projectIds: string[],
): Promise<Map<string, TemplateCost>> {
  if (projectIds.length === 0) return new Map()
  const result = await query<{
    projectId: string
    value: string | null
    charges: number
  }>(
    `SELECT b.project_id AS "projectId",
            percentile_cont(0.5) WITHIN GROUP (
              ORDER BY (b.our_cents + b.vendor_cents + b.margin_cents) / b.units
            )::text AS value,
            COUNT(*)::int AS charges
       FROM billing_transactions b
      WHERE b.project_id = ANY($1::text[])
        AND b.kind IN ('charge', 'exempt')
        AND b.pay_meter = 'sec'
        AND b.units > 0
      GROUP BY b.project_id`,
    [projectIds],
  )

  const map = new Map<string, TemplateCost>()
  for (const row of result.rows) {
    const value = row.value == null ? null : Number(row.value)
    map.set(row.projectId, {
      projectId: row.projectId,
      centsPerSec: value != null && Number.isFinite(value) ? value : null,
      charges: row.charges,
    })
  }
  return map
}
