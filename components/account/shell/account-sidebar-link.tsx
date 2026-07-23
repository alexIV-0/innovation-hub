"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { isAccountItemActive, type AccountNavItem } from "./nav-config"

type Props = {
  item: AccountNavItem
  onNavigate?: () => void
}

export function AccountSidebarLink({ item, onNavigate }: Props) {
  const pathname = usePathname()
  const active = isAccountItemActive(item, pathname ?? "")
  const Icon = item.icon
  const isDestructive = item.tone === "destructive"

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150",
        active
          ? isDestructive
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/[0.09] text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.18)]"
          : isDestructive
            ? "text-destructive/80 hover:bg-destructive/5 hover:text-destructive"
            : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-4 -translate-y-1/2 rounded-full transition-all duration-200",
          isDestructive ? "bg-destructive" : "bg-primary",
          active ? "w-[3px] opacity-100" : "w-0 opacity-0",
        )}
        aria-hidden
      />
      <Icon
        className={cn(
          "h-4 w-4 shrink-0 transition-colors duration-150",
          active
            ? isDestructive
              ? "text-destructive"
              : "text-primary"
            : "text-muted-foreground/70 group-hover:text-foreground",
        )}
      />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  )
}
