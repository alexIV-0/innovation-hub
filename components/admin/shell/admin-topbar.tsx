"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowLeft, ArrowUpRight, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { adminNavItems, isItemActive } from "./nav-config"
import { AdminMobileSidebar } from "./admin-mobile-sidebar"

type Props = {
  email: string
  fullName: string
}

export function AdminTopbar({ email, fullName }: Props) {
  const pathname = usePathname() ?? ""
  const current = adminNavItems.find((item) => isItemActive(item, pathname))

  return (
    <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-xl lg:px-8">
      <AdminMobileSidebar email={email} fullName={fullName} />

      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 text-sm"
      >
        <span className="text-muted-foreground">Admin</span>
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
          className="gap-1.5 rounded-full text-muted-foreground hover:text-foreground"
        >
          <Link href="/account">
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
        </Button>
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
