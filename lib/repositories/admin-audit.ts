import { query } from "@/lib/db"
import type { AuditAction } from "@/lib/audit-actions"

// Список действий живёт в чистом модуле, чтобы его мог импортировать интерфейс.
// Реэкспорт — для серверных вызывающих, которым удобнее один импорт отсюда.
export { AUDIT_ACTIONS, isAuditAction, type AuditAction } from "@/lib/audit-actions"

export type AuditEvent = {
  id: string
  actorId: string | null
  actorEmail: string
  action: AuditAction
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  meta: Record<string, unknown>
  ip: string | null
  createdAt: Date
}

const EVENT_FIELDS = `
  id::text AS id,
  actor_id    AS "actorId",
  actor_email AS "actorEmail",
  action,
  target_type AS "targetType",
  target_id   AS "targetId",
  meta,
  ip,
  created_at  AS "createdAt"
`

/**
 * Записать событие. **Никогда не бросает.**
 *
 * Журнал — наблюдение за действием, а не его часть. Упавшая вставка не должна
 * ронять то, что уже произошло: пользователь удалён, токен выпущен, роль
 * изменена. Поэтому ошибка уходит в лог процесса, а вызывающий её не видит и не
 * обязан оборачивать вызов в try.
 */
export async function recordAuditEvent(input: {
  actorId: string | null
  actorEmail: string
  action: AuditAction
  targetType?: string | null
  targetId?: string | null
  /** Человекочитаемая подпись цели на момент события: email, имя компьютера. */
  targetLabel?: string | null
  meta?: Record<string, unknown>
  ip?: string | null
}): Promise<void> {
  try {
    const meta = { ...(input.meta ?? {}) }
    if (input.targetLabel) meta.label = input.targetLabel

    await query(
      `INSERT INTO admin_audit_log
         (actor_id, actor_email, action, target_type, target_id, meta, ip)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
      [
        input.actorId,
        input.actorEmail,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        JSON.stringify(meta),
        input.ip ?? null,
      ],
    )
  } catch (error) {
    console.error("[audit] failed to record", input.action, error)
  }
}

/**
 * Лента, «сначала свежее». Курсор — по `id`, а не по времени: id монотонен и
 * уникален, поэтому страницы не разъезжаются, когда в одну секунду попало
 * несколько событий.
 */
export async function listAuditEvents(options: {
  limit: number
  before?: string | null
  action?: AuditAction | null
  actorId?: string | null
  /**
   * «Что происходило вот с этим». Пара, а не один `targetId`: идентификаторы
   * разных сущностей ниоткуда не обязаны различаться, и выборка по голому id
   * рано или поздно смешает историю аккаунта с историей проекта. Под этот
   * вопрос стоит индекс `admin_audit_log_target_idx` — он тоже по паре.
   */
  targetType?: string | null
  targetId?: string | null
}): Promise<{ events: AuditEvent[]; nextCursor: string | null }> {
  const conditions: string[] = []
  const params: unknown[] = []

  if (options.before) {
    params.push(options.before)
    conditions.push(`id < $${params.length}::bigint`)
  }
  if (options.action) {
    params.push(options.action)
    conditions.push(`action = $${params.length}`)
  }
  if (options.actorId) {
    params.push(options.actorId)
    conditions.push(`actor_id = $${params.length}`)
  }
  if (options.targetType && options.targetId) {
    params.push(options.targetType)
    conditions.push(`target_type = $${params.length}`)
    params.push(options.targetId)
    conditions.push(`target_id = $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
  // +1 строка сверх лимита — так узнаём, есть ли следующая страница, не считая
  // весь журнал отдельным COUNT'ом.
  params.push(options.limit + 1)

  const result = await query<AuditEvent>(
    `SELECT ${EVENT_FIELDS}
       FROM admin_audit_log
       ${where}
      ORDER BY id DESC
      LIMIT $${params.length}`,
    params,
  )

  const rows = result.rows
  const hasMore = rows.length > options.limit
  const events = hasMore ? rows.slice(0, options.limit) : rows

  return {
    events: events.map((row) => ({
      ...row,
      targetLabel:
        typeof row.meta?.label === "string" ? (row.meta.label as string) : null,
    })),
    nextCursor: hasMore ? (events[events.length - 1]?.id ?? null) : null,
  }
}
