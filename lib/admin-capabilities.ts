/**
 * Теги прав админа — что ему открыто по работе.
 *
 * Чистый модуль: без базы и без `next/server`, потому что его импортируют и
 * роуты, и интерфейс. Матрица одна, а не по копии на слой.
 *
 * Как это соотносится с ролью (lib/admin-roles.ts): два механизма, и они не
 * пересекаются. Лестница отвечает, пускать ли в админку и кто кем управляет;
 * теги — какие разделы работы открыты. Полный разбор — docs/ADMIN_ROLES_PLAN.md.
 *
 * ГЛАВНОЕ ПРАВИЛО: теги раздают доступ к работе, но никогда — к раздаче доступа.
 * Ни один тег не даёт выдавать теги, менять роли и трогать другого админа: это
 * свойство роли SUPERADMIN и только её. Тега вроде `capabilities.grant` в этом
 * списке нет и быть не должно — с ним админ дотянулся бы до суперадмина через
 * сам механизм тегов.
 */
import type { UserRole } from "@/lib/domain-types"
import { isSuperAdmin } from "@/lib/admin-roles"

export const ADMIN_CAPABILITIES = [
  "users.read",
  "users.manage",
  "content.manage",
  "pipeline.operate",
  "settings.write",
  "machines.manage",
  "projects.access",
  "statistics.view",
  "statistics.import",
  "visitors.view",
  "billing.manage",
  "audit.view",
] as const

export type AdminCapability = (typeof ADMIN_CAPABILITIES)[number]

export function isAdminCapability(value: unknown): value is AdminCapability {
  return (
    typeof value === "string" &&
    (ADMIN_CAPABILITIES as readonly string[]).includes(value)
  )
}

/**
 * Есть ли у актора право на действие.
 *
 * Суперадмину теги не проверяются: у него их нет в таблице и не должно быть.
 * Всем, кто ниже админа, — отказ независимо от содержимого `granted`: тег,
 * оставшийся у понижённого до USER аккаунта, не должен ничего открывать.
 */
export function hasCapability(
  role: UserRole,
  granted: readonly AdminCapability[] | null | undefined,
  needed: AdminCapability,
): boolean {
  if (isSuperAdmin(role)) return true
  if (role !== "ADMIN") return false
  return granted?.includes(needed) ?? false
}

/**
 * Наборы галочек для экрана выдачи.
 *
 * Не сущность в базе и не роль: кнопка проставляет группу тегов, дальше их
 * правят поштучно. Хранится всё равно плоский набор — иначе получим второй
 * уровень иерархии, который придётся синхронизировать с первым.
 */
export const CAPABILITY_PRESETS = {
  content: ["content.manage", "visitors.view"],
  support: ["users.read", "projects.access"],
  pipeline: ["pipeline.operate", "settings.write", "statistics.view"],
  full: [...ADMIN_CAPABILITIES],
} as const satisfies Record<string, readonly AdminCapability[]>

export type CapabilityPreset = keyof typeof CAPABILITY_PRESETS
export const CAPABILITY_PRESET_NAMES = Object.keys(
  CAPABILITY_PRESETS,
) as CapabilityPreset[]
