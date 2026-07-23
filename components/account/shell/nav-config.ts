import {
  FolderKanban,
  LayoutDashboard,
  UserRound,
  type LucideIcon,
} from "lucide-react"

export type AccountNavItem = {
  label: string
  href: string
  icon: LucideIcon
  description: string
  exact?: boolean
  tone?: "default" | "destructive"
}

export type AccountNavGroup = {
  label: string
  items: AccountNavItem[]
}

export const accountNavGroups: AccountNavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        label: "Dashboard",
        href: "/account/dashboard",
        icon: LayoutDashboard,
        description: "Projects and content pipeline",
        exact: true,
      },
      {
        label: "Projects",
        href: "/account/projects",
        icon: FolderKanban,
        description: "Create and manage projects",
      },
    ],
  },
  {
    label: "Account",
    items: [
      {
        label: "Profile",
        href: "/account",
        icon: UserRound,
        description: "Name, email and security",
        exact: true,
      },
    ],
  },
]

export const accountNavItems: AccountNavItem[] = accountNavGroups.flatMap(
  (group) => group.items,
)

export function isAccountItemActive(item: AccountNavItem, pathname: string) {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
