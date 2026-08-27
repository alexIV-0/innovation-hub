"use client"
import { cn } from "@/lib/utils"
import { isElevated } from "@/lib/admin-roles"

import Link from "next/link"
import { ArrowRight, ShieldCheck, Users } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/account/i18n"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { EmptyState } from "@/components/admin/shared/empty-state"

function avatarLetter(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "?"
  const match = trimmed.match(/\p{L}/u)
  return (match ? match[0] : trimmed[0]).toLocaleUpperCase()
}

function formatDate(value: string, locale: string) {
  try {
    return new Date(value).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
    })
  } catch {
    return ""
  }
}

export function OverviewTeam() {
  const { users } = useAdminData()
  const t = useAdminI18n()
  const { lang } = useI18n()
  const recent = [...users]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 5)

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t.people}
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
            {t.newestAccounts}
          </h2>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Link href="/admin/users">
            {t.manage}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {recent.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title={t.noPeopleYet}
            description={t.noPeopleYetDesc}
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {recent.map((user) => (
            <li
              key={user.id}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <Avatar className="h-9 w-9 border border-border/60">
                <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
                  {avatarLetter(user.fullName || user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {user.fullName || user.email}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isElevated(user.role) ? (
                  <Badge
                    className={cn(
                      "gap-1 border-transparent",
                      user.role === "SUPERADMIN"
                        ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/15"
                        : "bg-primary/15 text-primary hover:bg-primary/15",
                    )}
                  >
                    <ShieldCheck className="h-3 w-3" />
                    {user.role === "SUPERADMIN" ? t.superadmin : t.admin}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t.member}</Badge>
                )}
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {formatDate(user.createdAt, lang === "ru" ? "ru-RU" : "en-US")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
