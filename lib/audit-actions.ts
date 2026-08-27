/**
 * Список действий журнала — без обращений к базе.
 *
 * Отдельным файлом по той же причине, что и lib/settings-types.ts: этот список
 * нужен и серверному репозиторию, и странице журнала. Лежи он в
 * repositories/admin-audit.ts, импорт значения (не типа) из клиента утянул бы в
 * браузерный бандл `pg`.
 *
 * Список закрытый: свободные строки в `action` означали бы, что фильтр в
 * интерфейсе нечем заполнить, а опечатка навсегда прячет событие от того, кто
 * будет разбираться. Добавлять новое действие — сюда.
 */
export const AUDIT_ACTIONS = [
  "user.created",
  "user.updated",
  "user.role_changed",
  "user.password_reset",
  "user.suspended",
  "user.reactivated",
  "user.deleted",
  "capability.granted",
  "capability.revoked",
  "computer.created",
  "computer.token_rotated",
  "computer.revoked",
  "settings.updated",
  "project.deleted",
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "string" &&
    (AUDIT_ACTIONS as readonly string[]).includes(value)
  )
}
