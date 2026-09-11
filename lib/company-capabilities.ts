/**
 * Теги прав внутри компании — вторая ось, независимая от lib/admin-capabilities.ts.
 *
 * Устройство повторяет сайтовые теги этажом ниже (docs/COMPANY_ACCOUNTS_PLAN.md
 * §4): `owner` — корень раздачи, ему теги не проверяются, как суперадмину на
 * сайте; `admin` — по факту выданных тегов; `member` — консоли не видит вовсе.
 *
 * Состав тегов — задел на консоль компании (этап 4): сама консоль на этом этапе
 * не строится, но реестр закрытый и определяется здесь, чтобы новый инструмент
 * компании приносил свой тег без миграции.
 */
import type { CompanyRole } from "@/lib/domain-types"

export const COMPANY_CAPABILITIES = [
  "wallet.manage",
  "statistics.view",
  "people.manage",
  "roles.manage",
  "keys.manage",
] as const

export type CompanyCapability = (typeof COMPANY_CAPABILITIES)[number]

export function isCompanyCapability(value: unknown): value is CompanyCapability {
  return (
    typeof value === "string" &&
    (COMPANY_CAPABILITIES as readonly string[]).includes(value)
  )
}

/**
 * Есть ли у человека тег внутри СВОЕЙ компании.
 *
 * `role` — company_role того, кого проверяют, а не его роль на сайте: это
 * разные оси (план §4). У `null` (человек не в компании) прав нет никаких.
 */
export function hasCompanyCapability(
  role: CompanyRole | null | undefined,
  granted: readonly CompanyCapability[] | null | undefined,
  needed: CompanyCapability,
): boolean {
  if (role === "owner") return true
  if (role !== "admin") return false
  return granted?.includes(needed) ?? false
}
