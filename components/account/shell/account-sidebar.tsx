"use client"

import Link from "next/link"
import { ShieldCheck } from "lucide-react"
import type { UserRole } from "@/lib/domain-types"
import { AccountSidebarLink } from "./account-sidebar-link"
import { AccountSidebarUser } from "./account-sidebar-user"
import { accountNavGroups } from "./nav-config"

type Props = {
  email: string
  fullName: string
  role: UserRole
  onNavigate?: () => void
}

export function AccountSidebar({ email, fullName, role, onNavigate }: Props) {
  return (
    <aside className="flex h-full w-full flex-col border-r border-border/50 bg-[hsl(var(--surface-1))]/85 backdrop-blur-xl lg:w-[264px]">
      <div className="px-5 pb-2 pt-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5"
          onClick={onNavigate}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/30 bg-gradient-to-b from-primary/25 to-primary/10 shadow-glow-soft transition-shadow group-hover:shadow-glow">
            <span className="font-display text-[11px] font-bold text-primary">
              FF
            </span>
          </span>
          <span className="font-display text-sm font-medium tracking-[0.08em] text-foreground/90">
            FF Works
          </span>
        </Link>
      </div>

      <nav className="scrollbar-elegant flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {accountNavGroups.map((group) => (
          <div key={group.label} className="space-y-0.5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              {group.label}
            </p>
            {group.items.map((item) => (
              <AccountSidebarLink
                key={item.href}
                item={item}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}

        {role === "ADMIN" ? (
          <div className="space-y-0.5">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
              Shortcuts
            </p>
            <Link
              href="/admin"
              onClick={onNavigate}
              className="group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-white/[0.05] hover:text-foreground"
            >
              <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-foreground" />
              <span className="flex-1 truncate">Admin dashboard</span>
            </Link>
          </div>
        ) : null}
      </nav>

      <div className="space-y-3 px-3 pb-4">
        <div className="divider-line" />
        <AccountSidebarUser email={email} fullName={fullName} />
      </div>
    </aside>
  )
}
