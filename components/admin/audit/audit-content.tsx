"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeftRight,
  FolderTree,
  KeyRound,
  Monitor,
  Plug,
  ScrollText,
  Settings2,
  ShieldCheck,
  Trash2,
  UserCog,
  Workflow,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
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
import { ACTION_META, TONE_CLASS } from "./action-meta"
import { detailsOf } from "./event-details"
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

export function AuditContent() {
  const { t: page, lang } = useI18n()
  const t = useAdminI18n()

  const [events, setEvents] = useState<AuditEvent[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [action, setAction] = useState<AuditAction | "all">("all")
  const [query, setQuery] = useState("")

  /**
   * Фильтр по цели живёт в адресе, а не в состоянии: сюда приходят по ссылке
   * «весь журнал по нему» из подсказки на строке пользователя, и такую ссылку
   * должно быть можно переслать и открыть в новой вкладке.
   */
  const searchParams = useSearchParams()
  const targetType = searchParams.get("targetType")
  const targetId = searchParams.get("targetId")
  const targetLabel = searchParams.get("targetLabel")

  const load = useCallback(
    async (before: string | null, nextAction: AuditAction | "all") => {
      const params = new URLSearchParams({ limit: "50" })
      if (before) params.set("before", before)
      if (nextAction !== "all") params.set("action", nextAction)
      if (targetType && targetId) {
        params.set("targetType", targetType)
        params.set("targetId", targetId)
      }

      const response = await fetch(`/api/admin/audit?${params}`, {
        cache: "no-store",
      })
      if (!response.ok) throw new Error("audit")
      return (await response.json()) as {
        events: AuditEvent[]
        nextCursor: string | null
      }
    },
    [targetType, targetId],
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

      {targetType && targetId ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-sm">
          <span className="text-muted-foreground">{t.auditTargetFilter}</span>
          <span className="font-medium text-foreground">
            {targetLabel || targetId}
          </span>
          <Link
            href="/admin/audit"
            className="ml-auto rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t.auditTargetFilterClear}
          </Link>
        </div>
      ) : null}

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
