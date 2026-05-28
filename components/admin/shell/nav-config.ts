import {
  Activity,
  LayoutDashboard,
  LayoutGrid,
  Users,
  type LucideIcon,
} from "lucide-react"

export type AdminNavItem = {
  label: string
  href: string
  icon: LucideIcon
  description: string
  exact?: boolean
}

export const adminNavItems: AdminNavItem[] = [
  {
    label: "Overview",
    href: "/admin",
    icon: LayoutDashboard,
    description: "Pulse of your studio",
    exact: true,
  },
  {
    label: "Content",
    href: "/admin/content",
    icon: LayoutGrid,
    description: "Videos & ideas in one place",
  },
  {
    label: "People",
    href: "/admin/users",
    icon: Users,
    description: "Team & accounts",
  },
  {
    label: "Visitors",
    href: "/admin/visitors",
    icon: Activity,
    description: "Live page-view tracker",
  },
]

export function isItemActive(item: AdminNavItem, pathname: string) {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
