import {
  FolderKanban,
  LayoutDashboard,
  ShieldCheck,
  TriangleAlert,
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

export const accountNavItems: AccountNavItem[] = [
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
  {
    label: "Profile",
    href: "/account",
    icon: UserRound,
    description: "Name, email and identity",
    exact: true,
  },
  {
    label: "Security",
    href: "/account/security",
    icon: ShieldCheck,
    description: "Password and sign-in",
  },
  {
    label: "Danger zone",
    href: "/account/danger",
    icon: TriangleAlert,
    description: "Delete the account",
    tone: "destructive",
  },
]

export function isAccountItemActive(item: AccountNavItem, pathname: string) {
  if (item.exact) return pathname === item.href
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
