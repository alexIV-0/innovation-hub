/**
 * Лестница админских ролей: USER < ADMIN < SUPERADMIN.
 *
 * Чистый модуль — без обращений к базе и без `next/server`, поэтому его
 * импортируют и роуты, и интерфейс: матрица одна, а не по копии на слой. Тот же
 * приём, что у `lib/project-roles.ts` для прав на проект.
 *
 * Почти все проверки — «не ниже чем», поэтому суперадмин автоматически проходит
 * везде, где хватает админа. Проверок «ровно эта ступень» в коде быть не должно:
 * именно они ломают парк машин, когда роль владельца токена меняется. Полный
 * разбор — docs/ADMIN_ROLES_PLAN.md §7.
 */
import type { UserRole } from "@/lib/domain-types"

export const USER_ROLES = ["USER", "ADMIN", "SUPERADMIN"] as const

const RANK: Record<UserRole, number> = {
  USER: 1,
  ADMIN: 2,
  SUPERADMIN: 3,
}

/**
 * Роль принимается строкой, а не `UserRole`, намеренно: сюда приходят и значения
 * из JWT старых сессий, и `caller.role: string` машинных поверхностей. Неизвестная
 * строка даёт `undefined` в RANK и сравнение `NaN >= n` — то есть отказ. Гвард
 * обязан падать в закрытую сторону.
 */
export function roleAtLeast(
  role: string | null | undefined,
  minimum: UserRole,
): boolean {
  if (role == null) return false
  return RANK[role as UserRole] >= RANK[minimum]
}

/**
 * «Это админский аккаунт вообще»: вход в /admin, обход владения в хранилище,
 * общая очередь у машины. Заменяет прежнее `role === "ADMIN"` везде, где
 * проверка означала именно это.
 */
export function isElevated(role: string | null | undefined): boolean {
  return roleAtLeast(role, "ADMIN")
}

/**
 * Раздача доступа: смена ролей, выдача тегов, действия над другим админом.
 * На машинных путях не спрашивается никогда — там только `isElevated`.
 */
export function isSuperAdmin(role: string | null | undefined): boolean {
  return roleAtLeast(role, "SUPERADMIN")
}

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === "string" &&
    (USER_ROLES as readonly string[]).includes(value)
  )
}
