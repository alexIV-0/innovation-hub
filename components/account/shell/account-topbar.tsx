"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowUpRight, ChevronRight } from "lucide-react"
import type { UserRole } from "@/lib/domain-types"
import { Button } from "@/components/ui/button"
import { accountNavItems, isAccountItemActive } from "./nav-config"
import { AccountMobileSidebar } from "./account-mobile-sidebar"

type Props = {
  email: string
  fullName: string
  role: UserRole
}

export function AccountTopbar({ email, fullName, role }: Props) {
  const pathname = usePathname() ?? ""
  const current = accountNavItems.find((item) => isAccountItemActive(item, pathname))

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl lg:px-8">
      <AccountMobileSidebar email={email} fullName={fullName} role={role} />

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 text-sm"
      >
        <span className="text-muted-foreground">Account</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="truncate font-medium text-foreground">
          {current?.label ?? "Section"}
        </span>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="hidden gap-1.5 rounded-full text-muted-foreground hover:text-foreground sm:inline-flex"
        >
          <Link href="/" target="_blank">
            View site
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
