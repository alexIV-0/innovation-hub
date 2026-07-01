"use client"

import Link from "next/link"
import type { UserRole } from "@/lib/domain-types"
import { AccountSidebarLink } from "./account-sidebar-link"
import { AccountSidebarUser } from "./account-sidebar-user"
import { accountNavItems } from "./nav-config"

type Props = {
  email: string
  fullName: string
  role: UserRole
  onNavigate?: () => void
}

export function AccountSidebar({ email, fullName, role, onNavigate }: Props) {
  return (
    <aside className="flex h-full w-full flex-col gap-4 border-r border-border/60 bg-[hsl(var(--surface-1))]/85 backdrop-blur-xl lg:w-72">
      <div className="px-5 pt-6">
        <Link
          href="/"
          className="flex items-center gap-2"
          onClick={onNavigate}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/30 bg-primary/15">
            <span className="font-display text-sm font-bold text-primary">
              FF
            </span>
          </span>
          <span className="font-display text-sm tracking-[0.08em] text-foreground/90">
            FF Works
          </span>
        </Link>
      </div>

      <nav className="scrollbar-elegant flex-1 space-y-1 overflow-y-auto px-3">
        <p className="px-3 pb-2 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
          Account
        </p>
        {accountNavItems.map((item) => (
          <AccountSidebarLink
            key={item.href}
            item={item}
            onNavigate={onNavigate}
          />
        ))}

        {role === "ADMIN" ? (
          <>
            <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/70">
              Shortcuts
            </p>
            <Link
              href="/admin"
              onClick={onNavigate}
              className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent bg-white/[0.03] text-muted-foreground group-hover:border-border group-hover:text-foreground">
                <span className="text-[10px] font-bold tracking-[0.15em]">A</span>
              </span>
              <span className="flex-1 truncate">Admin dashboard</span>
            </Link>
          </>
        ) : null}
      </nav>

      <div className="space-y-3 px-3 pb-4">
        <div className="h-px bg-border/60" />
        <AccountSidebarUser email={email} fullName={fullName} />
      </div>
    </aside>
  )
}
