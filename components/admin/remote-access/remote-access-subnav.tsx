"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { cn } from "@/lib/utils"

export function RemoteAccessSubnav() {
  const pathname = usePathname()
  const t = useAdminI18n()
  const items = [
    {
      href: "/admin/remote-access",
      label: t.remoteTabComputers,
      exact: true,
    },
    {
      href: "/admin/remote-access/api",
      label: t.remoteTabApi,
      exact: true,
    },
  ]

  return (
    <nav className="flex w-fit gap-1 rounded-full border border-border bg-muted/40 p-1">
      {items.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
