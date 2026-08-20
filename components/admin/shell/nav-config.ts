import {
  Activity,
  BarChart3,
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import type { DictKey } from "@/components/account/i18n"

export type AdminNavItem = {
  labelKey: DictKey
  href: string
  icon: LucideIcon
  exact?: boolean
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
    href: "/admin/content",
    icon: LayoutGrid,
  },
  {
    labelKey: "adminPeople",
    href: "/admin/users",
    icon: Users,
  },
  {
    labelKey: "adminVisitors",
    href: "/admin/visitors",
    icon: Activity,
  },
  {
    labelKey: "adminStatistics",
    href: "/admin/statistics",
    icon: BarChart3,
  },
  {
    labelKey: "adminRemoteAccess",
    href: "/admin/remote-access",
    icon: Monitor,
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
