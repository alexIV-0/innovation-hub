import {
  Activity,
  LayoutDashboard,
  LayoutGrid,
  Monitor,
  Users,
  type LucideIcon,
} from "lucide-react"
import type { DictKey } from "@/components/account/i18n"

export type AdminNavItem = {
  labelKey: DictKey
  href: string
  icon: LucideIcon
  exact?: boolean
}

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
    labelKey: "adminRemoteAccess",
    href: "/admin/remote-access",
    icon: Monitor,
  },
]

export function isItemActive(item: AdminNavItem, pathname: string) {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
