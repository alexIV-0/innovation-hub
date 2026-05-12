"use client"

import { AdminDataProvider } from "@/components/admin/data/admin-data-context"
import { AdminSidebar } from "./admin-sidebar"
import { AdminTopbar } from "./admin-topbar"

type Props = {
  currentUserId: string
  email: string
  fullName: string
  children: React.ReactNode
}

export function AdminShell({ currentUserId, email, fullName, children }: Props) {
  return (
    <AdminDataProvider currentUserId={currentUserId}>
      <div className="flex min-h-screen bg-background">
        <div className="sticky top-0 hidden h-screen shrink-0 self-start lg:flex">
          <AdminSidebar email={email} fullName={fullName} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar email={email} fullName={fullName} />
          <main className="flex-1">
            <div className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-10">
              {children}
            </div>
          </main>
        </div>
      </div>
    </AdminDataProvider>
  )
}
