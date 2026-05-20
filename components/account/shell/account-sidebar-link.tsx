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
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? isDestructive
            ? "bg-destructive/10 text-destructive shadow-[inset_0_0_0_1px_hsl(var(--destructive)/0.3)]"
            : "bg-primary/12 text-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
          : isDestructive
            ? "text-destructive/80 hover:bg-destructive/5 hover:text-destructive"
            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-full transition-all",
          isDestructive ? "bg-destructive" : "bg-primary",
          active ? "w-[3px] opacity-100" : "w-0 opacity-0",
        )}
        aria-hidden
      />
      <span
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
          active
            ? isDestructive
              ? "border-destructive/40 bg-destructive/15 text-destructive"
              : "border-primary/40 bg-primary/15 text-primary"
            : isDestructive
              ? "border-transparent bg-destructive/[0.06] text-destructive/80 group-hover:border-destructive/40 group-hover:text-destructive"
              : "border-transparent bg-white/[0.03] text-muted-foreground group-hover:border-border group-hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  )
}
