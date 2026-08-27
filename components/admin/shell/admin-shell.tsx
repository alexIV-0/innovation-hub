"use client"

import { usePathname } from "next/navigation"
import { AdminDataProvider } from "@/components/admin/data/admin-data-context"
import type { UserRole } from "@/lib/domain-types"
import type { AdminCapability } from "@/lib/admin-capabilities"

type Props = {
  currentUserId: string
  currentUserRole: UserRole
  currentUserCapabilities: AdminCapability[]
  children: React.ReactNode
}

/**
 * Страницы-рабочие области: занимают всю высоту и ширину, скроллят внутри себя.
 *
 * Остальные страницы админки — это документы: центрированная колонка с отбивками
 * и общий вертикальный скролл. «Конвейеру» такая обёртка не подходит: у него три
 * колонки со своими скроллами и полоса запуска, приклеенная к нижней границе, —
 * внутри max-w-7xl с padding'ом всё это ужимается и от низа отрывается.
 */
const FULL_BLEED_PATHS = ["/admin/pipeline"]

export function AdminShell({
  currentUserId,
  currentUserRole,
  currentUserCapabilities,
  children,
}: Props) {
  const pathname = usePathname()
  const fullBleed = FULL_BLEED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )

  return (
    <AdminDataProvider
      currentUserId={currentUserId}
      currentUserRole={currentUserRole}
      currentUserCapabilities={currentUserCapabilities}
    >
      {fullBleed ? (
        <div className="h-full overflow-hidden bg-background">{children}</div>
      ) : (
        <div className="h-full overflow-y-auto bg-background">
          <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8 md:py-10">
            {children}
          </main>
        </div>
      )}
    </AdminDataProvider>
  )
}
