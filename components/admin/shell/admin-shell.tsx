"use client"

import { AdminDataProvider } from "@/components/admin/data/admin-data-context"

type Props = {
  currentUserId: string
  children: React.ReactNode
}

export function AdminShell({ currentUserId, children }: Props) {
  return (
    <AdminDataProvider currentUserId={currentUserId}>
      <div className="h-full overflow-y-auto bg-background">
        <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-10">
          {children}
        </main>
      </div>
    </AdminDataProvider>
  )
}
