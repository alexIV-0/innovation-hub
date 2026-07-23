"use client"

import type { UserRole } from "@/lib/domain-types"
import { AccountSidebar } from "./account-sidebar"
import { AccountTopbar } from "./account-topbar"

type Props = {
  email: string
  fullName: string
  role: UserRole
  children: React.ReactNode
}

export function AccountShell({ email, fullName, role, children }: Props) {
  return (
    <div className="flex min-h-screen bg-background">
      <div className="sticky top-0 hidden h-screen shrink-0 self-start lg:flex">
        <AccountSidebar email={email} fullName={fullName} role={role} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <AccountTopbar email={email} fullName={fullName} role={role} />
        <main className="relative flex-1">
          {/* Ambient top glow so the workspace doesn't feel flat. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(600px_200px_at_50%_-40px,hsl(var(--primary)/0.08),transparent_70%)]"
          />
          <div className="relative w-full px-4 py-8 md:px-8 md:py-10 lg:px-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
