import { query } from "@/lib/db"
import type { PayBase, PayMeter } from "@/lib/billing/types"

/**
 * Настройки тарификации на проекте.
 *
 * Оси здесь — ЗАПАСНОЙ путь: главным остаётся объявленное в графе. Но и не
 * временный костыль — `onInit` в десктопе ставит ноды из `options.json` как
 * есть, и новое обязательное свойство в старые графы само не приезжает.
 */

export type ProjectBilling = {
  projectId: string
  name: string
  ownerId: string
  payBase: PayBase | null
  payMeter: PayMeter | null
  estimateUnits: number | null
  isTemplate: boolean
  templateOrder: number | null
  pausedReason: string | null
}

const FIELDS = `
  p.id            AS "projectId",
  p.name,
  p.user_id       AS "ownerId",
  p.pay_base      AS "payBase",
  p.pay_meter     AS "payMeter",
  p.estimate_units::float8 AS "estimateUnits",
  COALESCE(p.is_template, FALSE) AS "isTemplate",
  p.template_order AS "templateOrder",
  p.paused_reason  AS "pausedReason"
`

export async function readProjectBilling(
  projectId: string,
): Promise<ProjectBilling | null> {
  const result = await query<ProjectBilling>(
    `SELECT ${FIELDS} FROM projects p WHERE p.id = $1 AND p.deleted_at IS NULL`,
    [projectId],
  )
  return result.rows[0] ?? null
}

export async function updateProjectBilling(input: {
  projectId: string
  payBase?: PayBase | null
  payMeter?: PayMeter | null
  estimateUnits?: number | null
  isTemplate?: boolean
  templateOrder?: number | null
}): Promise<ProjectBilling | null> {
  const sets: string[] = []
  const params: unknown[] = [input.projectId]
  const push = (column: string, value: unknown) => {
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }

  if (input.payBase !== undefined) push("pay_base", input.payBase)
  if (input.payMeter !== undefined) push("pay_meter", input.payMeter)
  if (input.estimateUnits !== undefined) push("estimate_units", input.estimateUnits)
  if (input.isTemplate !== undefined) push("is_template", input.isTemplate)
  if (input.templateOrder !== undefined) push("template_order", input.templateOrder)

  if (sets.length === 0) return readProjectBilling(input.projectId)

  const result = await query<ProjectBilling>(
    `UPDATE projects p
        SET ${sets.join(", ")}, updated_at = NOW()
      WHERE p.id = $1 AND p.deleted_at IS NULL
      RETURNING ${FIELDS}`,
    params,
  )
  return result.rows[0] ?? null
}

/**
 * Шаблоны пробного набора, по порядку.
 *
 * Из слежения конвейера они исключаются отдельно (П10): шаблон не должен
 * обрабатывать сам себя, иначе его `_stats` уедут в статистику как чужая работа.
 */
export async function listTemplateProjects(): Promise<ProjectBilling[]> {
  const result = await query<ProjectBilling>(
    `SELECT ${FIELDS}
       FROM projects p
      WHERE COALESCE(p.is_template, FALSE)
        AND p.deleted_at IS NULL
      ORDER BY p.template_order ASC NULLS LAST, p.created_at ASC`,
  )
  return result.rows
}

/**
 * Проекты, у которых оси не заданы НА САЙТЕ.
 *
 * ⚠️ Это не полный ответ на «какие проекты нечем тарифицировать»: граф мог
 * объявить оси сам, и такой проект попадёт сюда напрасно. Полный список даёт
 * прогон сборки — он читает `options.json` и возвращает `unpriced`
 * (lib/pipeline/scan.ts). Здесь — быстрая выборка «что точно не настроено
 * руками», и называть её иначе значило бы обещать больше, чем она знает.
 */
export async function listProjectsWithoutSitePayUnit(): Promise<ProjectBilling[]> {
  const result = await query<ProjectBilling>(
    `SELECT ${FIELDS}
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE p.pay_base IS NULL
        AND p.deleted_at IS NULL
        AND COALESCE(p.is_archived, FALSE) = FALSE
        AND COALESCE(p.is_template, FALSE) = FALSE
        AND u.is_active
      ORDER BY p.updated_at DESC`,
  )
  return result.rows
}
