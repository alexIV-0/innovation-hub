"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  KeyRound,
  Monitor,
  ScrollText,
  Settings2,
  ShieldCheck,
  Trash2,
  UserCog,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { SearchInput } from "@/components/admin/shared/search-input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AUDIT_ACTIONS, type AuditAction } from "@/lib/audit-actions"
import { cn } from "@/lib/utils"

type AuditEvent = {
  id: string
  actorId: string | null
  actorEmail: string
  action: AuditAction
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  meta: Record<string, unknown>
  ip: string | null
  createdAt: string
}

type Dict = ReturnType<typeof useAdminI18n>

/**
 * Подпись действия и его вес. Иконка и цвет несут смысл, а не украшают: по ленте
 * должно быть видно, где раздали доступ, а где поправили профиль, не вчитываясь.
 */
const ACTION_META: Record<
  AuditAction,
  {
    labelKey: keyof Dict
    icon: typeof UserCog
    tone: "access" | "danger" | "neutral"
  }
> = {
  "user.created": { labelKey: "auditUserCreated", icon: UserCog, tone: "neutral" },
  "user.updated": { labelKey: "auditUserUpdated", icon: UserCog, tone: "neutral" },
  "user.role_changed": {
    labelKey: "auditUserRoleChanged",
    icon: ShieldCheck,
    tone: "access",
  },
  "user.password_reset": {
    labelKey: "auditUserPasswordReset",
    icon: KeyRound,
    tone: "access",
  },
  "user.suspended": {
    labelKey: "auditUserSuspended",
    icon: UserCog,
    tone: "danger",
  },
  "user.reactivated": {
    labelKey: "auditUserReactivated",
    icon: UserCog,
    tone: "neutral",
  },
  "user.deleted": { labelKey: "auditUserDeleted", icon: Trash2, tone: "danger" },
  "capability.granted": {
    labelKey: "auditCapabilityGranted",
    icon: ShieldCheck,
    tone: "access",
  },
  "capability.revoked": {
    labelKey: "auditCapabilityRevoked",
    icon: ShieldCheck,
    tone: "access",
  },
  "computer.created": {
    labelKey: "auditComputerCreated",
    icon: Monitor,
    tone: "access",
  },
  "computer.token_rotated": {
    labelKey: "auditComputerTokenRotated",
    icon: KeyRound,
    tone: "access",
  },
  "computer.revoked": {
    labelKey: "auditComputerRevoked",
    icon: Monitor,
    tone: "neutral",
  },
  "machine_token.revoked": {
    labelKey: "auditMachineTokenRevoked",
    icon: KeyRound,
    tone: "access",
  },
  "settings.updated": {
    labelKey: "auditSettingsUpdated",
    icon: Settings2,
    tone: "neutral",
  },
  "project.deleted": {
    labelKey: "auditProjectDeleted",
    icon: Trash2,
    tone: "danger",
  },
}

const TONE_CLASS = {
  access: "bg-amber-500/15 text-amber-300",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-primary/10 text-primary",
} as const

function formatMoment(value: string, locale: string) {
  try {
    return new Date(value).toLocaleString(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return value
  }
}

/**
 * Строка подробностей: то, ради чего в журнал вообще заглядывают. Для смены роли
 * это «из чего во что», для удаления проекта — чем именно его удалили.
 */
function detailsOf(event: AuditEvent, t: Dict): string | null {
  const meta = event.meta ?? {}

  if (event.action === "user.role_changed") {
    const from = typeof meta.from === "string" ? meta.from : "?"
    const to = typeof meta.to === "string" ? meta.to : "?"
    return tf(t.auditRoleFromTo, { from, to })
  }
  if (event.action === "user.password_reset" && meta.isSelf === true) {
    return t.auditSelfNote
  }
  if (event.action === "project.deleted") {
    if (meta.via === "computer") return t.auditViaComputer
    if (meta.via === "machine") return t.auditViaMachine
    return t.auditViaSession
  }
  if (event.action === "settings.updated" && Array.isArray(meta.domains)) {
    return meta.domains.join(", ")
  }
  if (
    (event.action === "user.created" || event.action === "user.deleted") &&
    typeof meta.role === "string"
  ) {
    return meta.role
  }
  if (event.action === "user.updated" && Array.isArray(meta.profileFields)) {
    return meta.profileFields.join(", ")
  }
  return null
}

export function AuditContent() {
  const { t: page, lang } = useI18n()
  const t = useAdminI18n()

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [action, setAction] = useState<AuditAction | "all">("all")
  const [query, setQuery] = useState("")

  const load = useCallback(
    async (before: string | null, nextAction: AuditAction | "all") => {
      const params = new URLSearchParams({ limit: "50" })
      if (before) params.set("before", before)
      if (nextAction !== "all") params.set("action", nextAction)

      const response = await fetch(`/api/admin/audit?${params}`, {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("audit")
      return (await response.json()) as {
        events: AuditEvent[]
        nextCursor: string | null
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load(null, action)
      .then((data) => {
        if (cancelled) return
        setEvents(data.events)
        setCursor(data.nextCursor)
      })
      .catch(() => {
        if (!cancelled) toast.error(t.auditLoadError)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [action, load, t.auditLoadError])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const data = await load(cursor, action)
      setEvents((prev) => [...prev, ...data.events])
      setCursor(data.nextCursor)
    } catch {
      toast.error(t.auditLoadError)
    } finally {
      setLoadingMore(false)
    }
  }

  // Поиск локальный, по уже загруженным страницам: сервер фильтрует по действию,
  // а «найди мне вот этот email» почти всегда про свежие записи, которые уже на
  // руках. Гонять полнотекстовый запрос ради этого не за чем.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return events
    return events.filter((event) =>
      [event.actorEmail, event.targetLabel, event.targetId, event.ip]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    )
  }, [events, query])

  const locale = lang === "ru" ? "ru-RU" : "en-US"

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={page.adminAuditEyebrow}
        title={page.adminAuditTitle}
        description={page.adminAuditDesc}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t.auditSearchPlaceholder}
        />
        <Select
          value={action}
          onValueChange={(value) => setAction(value as AuditAction | "all")}
        >
          <SelectTrigger className="h-10 w-full rounded-xl border-border/70 bg-card/40 text-sm sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.auditAllActions}</SelectItem>
            {AUDIT_ACTIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {t[ACTION_META[value].labelKey] as string}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ScrollText className="h-5 w-5" />}
          title={events.length === 0 ? t.auditEmpty : t.auditNoMatch}
          description={
            events.length === 0 ? t.auditEmptyDesc : t.auditNoMatchDesc
          }
        />
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {filtered.map((event) => {
              const meta = ACTION_META[event.action]
              const Icon = meta.icon
              const details = detailsOf(event, t)

              return (
                <li
                  key={event.id}
                  className="flex items-start gap-3 rounded-2xl border border-border/60 bg-card/40 px-4 py-3"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                      TONE_CLASS[meta.tone],
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {t[meta.labelKey] as string}
                      </span>
                      {event.targetLabel ? (
                        <span className="truncate text-sm text-muted-foreground">
                          {event.targetLabel}
                        </span>
                      ) : null}
                      {details ? (
                        <span className="rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {details}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {event.actorEmail}
                      {event.ip && event.ip !== "unknown" ? ` · ${event.ip}` : ""}
                    </p>
                  </div>

                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatMoment(event.createdAt, locale)}
                  </span>
                </li>
              )
            })}
          </ul>

          {cursor ? (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => void loadMore()}
                disabled={loadingMore}
              >
                {loadingMore ? t.loading : t.auditLoadMore}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
