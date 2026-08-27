import {
  Activity,
  BarChart3,
  Coins,
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  ScrollText,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import type { DictKey } from "@/components/account/i18n"
import {
  hasCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"
import type { UserRole } from "@/lib/domain-types"

export type AdminNavItem = {
  labelKey: DictKey
  href: string
  icon: LucideIcon
  exact?: boolean
  /**
   * Тег, без которого раздела для человека не существует. У обзора его нет:
   * это точка входа, она открыта каждому, кто вообще попал в админку.
   */
  capability?: AdminCapability
}

/** Разделы внутри свёртки «Админка». */
export const adminNavItems: AdminNavItem[] = [
  {
    labelKey: "adminOverview",
    href: "/admin",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    labelKey: "adminContent",
    capability: "content.manage",
    href: "/admin/content",
    icon: LayoutGrid,
  },
  {
    labelKey: "adminPeople",
    capability: "users.read",
    href: "/admin/users",
    icon: Users,
  },
  {
    labelKey: "adminVisitors",
    capability: "visitors.view",
    href: "/admin/visitors",
    icon: Activity,
  },
  {
    labelKey: "adminStatistics",
    capability: "statistics.view",
    href: "/admin/statistics",
    icon: BarChart3,
  },
  {
    labelKey: "adminRemoteAccess",
    capability: "pipeline.operate",
    href: "/admin/remote-access",
    icon: Monitor,
  },
  {
    labelKey: "adminBilling",
    capability: "billing.manage",
    href: "/admin/billing",
    icon: Coins,
  },
  {
    labelKey: "adminAudit",
    capability: "audit.view",
    href: "/admin/audit",
    icon: ScrollText,
  },
]

/**
 * Разделы админки, поднятые в боковом меню на один уровень с «Админкой».
 * «Конвейер» — рабочий инструмент на каждый день, а не страница-документ,
 * поэтому до него не должно быть двух клика через свёртку.
 */
export const adminStandaloneItems: AdminNavItem[] = [
  {
    labelKey: "adminPipeline",
    capability: "pipeline.operate",
    href: "/admin/pipeline",
    icon: Workflow,
  },
]

/** Все админские разделы — для поиска текущего по адресу (заголовки, крошки). */
export const adminAllNavItems: AdminNavItem[] = [
  ...adminNavItems,
  ...adminStandaloneItems,
]

export function isItemActive(item: AdminNavItem, pathname: string) {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}

/**
 * Что показывать в меню этому человеку.
 *
 * Раздел без тега не рисуется вовсе, а не гаснет с замком: серый пункт с замком
 * сообщает «тебе сюда нельзя, но оно есть», и дальше человек идёт спрашивать.
 * Скрытый пункт честнее — для него этого раздела просто нет.
 *
 * Дублирует гвард страницы (lib/admin-page-guard.ts) намеренно: меню — про
 * удобство, гвард — про доступ, и полагаться на скрытую кнопку как на защиту
 * нельзя.
 */
export function visibleNavItems(
  items: AdminNavItem[],
  role: UserRole,
  capabilities: readonly AdminCapability[],
): AdminNavItem[] {
  return items.filter(
    (item) =>
      !item.capability || hasCapability(role, capabilities, item.capability),
  )
}
