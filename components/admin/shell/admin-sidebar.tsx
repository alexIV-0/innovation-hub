"use client"

import Link from "next/link"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminSidebarLink } from "./admin-sidebar-link"
import { AdminSidebarUser } from "./admin-sidebar-user"
import { adminNavItems } from "./nav-config"

type Props = {
  email: string
  fullName: string
  onNavigate?: () => void
}

export function AdminSidebar({ email, fullName, onNavigate }: Props) {
  const { videos, ideas, users, signOut } = useAdminData()

  const counts: Record<string, number> = {
    "/admin/content": videos.length + ideas.length,
    "/admin/users": users.length,
  }

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
          Workspace
        </p>
        {adminNavItems.map((item) => (
          <AdminSidebarLink
            key={item.href}
            item={item}
            badge={counts[item.href]}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      <div className="space-y-3 px-3 pb-4">
        <div className="h-px bg-border/60" />
        <AdminSidebarUser
          email={email}
          fullName={fullName}
          onSignOut={signOut}
        />
      </div>
    </aside>
  )
}
