"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  CalendarClock,
  Eye,
  Fingerprint,
  Globe,
  Languages,
  Mail,
  MonitorSmartphone,
  RefreshCcw,
  ShieldCheck,
  User as UserIcon,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { SearchInput } from "@/components/admin/shared/search-input"
import { StatCard } from "@/components/admin/shared/stat-card"
import { cn } from "@/lib/utils"

type VisitorEvent = {
  id: string
  path: string
  queryString: string
  method: string
  userId: string | null
  userEmail: string | null
  userFullName: string | null
  fingerprint: string
  userAgent: string
  ip: string
  referer: string
  language: string
  createdAt: string
}

type VisitorGroup = {
  key: string
  fingerprint: string
  userId: string | null
  userEmail: string | null
  userFullName: string | null
  userAgent: string
  ip: string
  language: string
  firstSeen: string
  lastSeen: string
  visits: number
  uniquePaths: number
  lastPath: string
}

type VisitorStats = {
  totalLast24h: number
  uniqueLast24h: number
  authedLast24h: number
  total7d: number
  unique7d: number
  topPaths: { path: string; visits: number }[]
}

type ApiResponse = {
  stats: VisitorStats
  events: VisitorEvent[]
  groups: VisitorGroup[]
}

type Audience = "all" | "authenticated" | "anonymous"
type Since = "24h" | "7d" | "30d" | "all"
type View = "groups" | "events"

export function VisitorsContent() {
  const { t: accountT, lang } = useI18n()
  const t = useAdminI18n()
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [view, setView] = useState<View>("groups")
  const [audience, setAudience] = useState<Audience>("all")
  const [since, setSince] = useState<Since>("24h")
  const [query, setQuery] = useState("")
  const audienceOptions: { id: Audience; label: string }[] = [
    { id: "all", label: t.audienceAll },
    { id: "authenticated", label: t.audienceSignedIn },
    { id: "anonymous", label: t.audienceAnonymous },
  ]
  const sinceOptions: { id: Since; label: string }[] = [
    { id: "24h", label: t.window24h },
    { id: "7d", label: t.window7d },
    { id: "30d", label: t.window30d },
    { id: "all", label: t.windowAll },
  ]
  const viewOptions: { id: View; label: string; icon: typeof Users }[] = [
    { id: "groups", label: t.viewVisitors, icon: Users },
    { id: "events", label: t.viewEvents, icon: Activity },
  ]

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      else setRefreshing(true)

      const params = new URLSearchParams()
      params.set("view", "all")
      params.set("audience", audience)
      if (since !== "all") params.set("since", since)
      if (query.trim()) params.set("q", query.trim())
      params.set("limit", "200")

      try {
        const response = await fetch(
          `/api/admin/visitors?${params.toString()}`,
          { cache: "no-store" },
        )
        if (!response.ok) throw new Error("load")
        const json = (await response.json()) as ApiResponse
        setData(json)
      } catch {
        toast.error(t.visitorsLoadError)
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [audience, since, query, t.visitorsLoadError],
  )

  useEffect(() => {
    void load()
  }, [load])

  const events = data?.events ?? []
  const groups = data?.groups ?? []
  const stats = data?.stats

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={accountT.adminVisitorsEyebrow}
        title={accountT.adminVisitorsTitle}
        description={accountT.adminVisitorsDesc}
        actions={
          <Button
            variant="outline"
            className="gap-2 rounded-full"
            onClick={() => void load({ silent: true })}
            disabled={refreshing}
          >
            <RefreshCcw
              className={cn("h-4 w-4", refreshing && "animate-spin")}
            />
            {t.refresh}
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t.visits24h}
          value={stats?.totalLast24h ?? 0}
          icon={Eye}
          accent="primary"
        />
        <StatCard
          label={t.unique24h}
          value={stats?.uniqueLast24h ?? 0}
          icon={Fingerprint}
          accent="violet"
          hint={t.uniqueHint}
        />
        <StatCard
          label={t.signedIn24h}
          value={stats?.authedLast24h ?? 0}
          icon={ShieldCheck}
          accent="emerald"
          hint={t.signedInHint}
        />
        <StatCard
          label={t.visits7d}
          value={stats?.total7d ?? 0}
          icon={CalendarClock}
          accent="amber"
          hint={tf(t.uniqueCount, { n: stats?.unique7d ?? 0 })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,320px)]">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={t.searchVisitors}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Pills value={view} onChange={setView} options={viewOptions} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterChips
              label={t.audience}
              value={audience}
              onChange={setAudience}
              options={audienceOptions}
            />
            <FilterChips
              label={t.window}
              value={since}
              onChange={setSince}
              options={sinceOptions}
            />
          </div>

          {loading ? (
            <LoadingBlock />
          ) : view === "groups" ? (
            groups.length === 0 ? (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title={t.noVisitorsWindow}
                description={t.noVisitorsWindowDesc}
              />
            ) : (
              <div className="space-y-2">
                {groups.map((group) => (
                  <VisitorGroupRow key={group.key} group={group} t={t} />
                ))}
              </div>
            )
          ) : events.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title={t.noEventsWindow}
              description={t.noEventsWindowDesc}
            />
          ) : (
            <div className="space-y-1.5">
              {events.map((event) => (
                <VisitorEventRow key={event.id} event={event} t={t} lang={lang} />
              ))}
            </div>
          )}
        </div>

        <TopPathsCard paths={stats?.topPaths ?? []} loading={loading} t={t} />
      </div>
    </div>
  )
}

type PillsProps<T extends string> = {
  value: T
  onChange: (value: T) => void
  options: { id: T; label: string; icon?: typeof Users }[]
}

function Pills<T extends string>({ value, onChange, options }: PillsProps<T>) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card/40 p-1">
      {options.map((option) => {
        const Icon = option.icon
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

type FilterChipsProps<T extends string> = {
  label: string
  value: T
  onChange: (value: T) => void
  options: { id: T; label: string }[]
}

function FilterChips<T extends string>({
  label,
  value,
  onChange,
  options,
}: FilterChipsProps<T>) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const active = value === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onChange(option.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                active
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function VisitorGroupRow({
  group,
  t,
}: {
  group: VisitorGroup
  t: ReturnType<typeof useAdminI18n>
}) {
  const ua = useMemo(
    () => parseUserAgent(group.userAgent, t.unknown),
    [group.userAgent, t.unknown],
  )
  const isAuthed = Boolean(group.userId)
  const initials = isAuthed
    ? makeInitials(group.userFullName ?? group.userEmail ?? "?")
    : group.fingerprint.slice(0, 2).toUpperCase()

  return (
    <div className="group relative flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-border md:flex-row md:items-center md:gap-4">
      <div className="flex items-center gap-3 md:flex-1">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xs font-semibold uppercase",
            isAuthed
              ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
              : "border-border/60 bg-muted/40 text-muted-foreground",
          )}
          aria-hidden
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate font-medium text-foreground">
              {isAuthed
                ? group.userFullName || group.userEmail || t.signedInUser
                : t.anonymous}
            </p>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                isAuthed
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-border/60 bg-muted/40 text-muted-foreground",
              )}
            >
              {isAuthed ? (
                <>
                  <ShieldCheck className="h-3 w-3" /> {t.signedIn}
                </>
              ) : (
                <>
                  <Fingerprint className="h-3 w-3" /> {group.fingerprint}
                </>
              )}
            </span>
          </div>
          {isAuthed && group.userEmail ? (
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
              <Mail className="h-3 w-3" />
              {group.userEmail}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <MonitorSmartphone className="h-3 w-3" />
              {ua.browser} • {ua.os}
            </span>
            {group.language ? (
              <span className="inline-flex items-center gap-1">
                <Languages className="h-3 w-3" />
                {primaryLanguage(group.language)}
              </span>
            ) : null}
            {group.ip ? (
              <span className="inline-flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {group.ip}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-xs md:w-[320px] md:grid-cols-3 md:gap-4 md:text-right">
        <Metric label={t.visits} value={group.visits} />
        <Metric label={t.pages} value={group.uniquePaths} />
        <Metric label={t.lastSeen} value={timeAgo(group.lastSeen, t)} mono={false} />
      </div>

      <div className="text-xs text-muted-foreground md:hidden">
        {t.lastOn}
        <span className="font-mono text-foreground/80">{group.lastPath || "—"}</span>
      </div>
      <div className="hidden text-right text-[11px] text-muted-foreground md:block md:basis-full">
        {t.lastOn}
        <span className="font-mono text-foreground/80">{group.lastPath || "—"}</span>
      </div>
    </div>
  )
}

function Metric({
  label,
  value,
  mono = true,
}: {
  label: string
  value: number | string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-semibold text-foreground",
          mono && "tabular-nums",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function VisitorEventRow({
  event,
  t,
  lang,
}: {
  event: VisitorEvent
  t: ReturnType<typeof useAdminI18n>
  lang: string
}) {
  const isAuthed = Boolean(event.userId)
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-sm">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
          isAuthed
            ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
            : "border-border/60 bg-muted/40 text-muted-foreground",
        )}
        aria-hidden
      >
        {isAuthed ? (
          <UserIcon className="h-3.5 w-3.5" />
        ) : (
          <Fingerprint className="h-3.5 w-3.5" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">
        {event.path}
        {event.queryString ? (
          <span className="text-muted-foreground">?{event.queryString}</span>
        ) : null}
      </span>
      <span className="hidden truncate text-xs text-muted-foreground md:block md:max-w-[180px]">
        {isAuthed
          ? event.userEmail || event.userFullName || t.signedIn
          : event.fingerprint}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {formatDateTime(event.createdAt, lang)}
      </span>
    </div>
  )
}

function TopPathsCard({
  paths,
  loading,
  t,
}: {
  paths: { path: string; visits: number }[]
  loading: boolean
  t: ReturnType<typeof useAdminI18n>
}) {
  const max = Math.max(1, ...paths.map((p) => p.visits))
  return (
    <aside className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{t.topPages7d}</h2>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {t.visits}
        </span>
      </div>
      {loading ? (
        <div className="py-6">
          <LoadingBlock label={t.counting} />
        </div>
      ) : paths.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {t.noPagesTracked}
        </p>
      ) : (
        <ul className="space-y-2">
          {paths.map((p) => {
            const pct = Math.round((p.visits / max) * 100)
            return (
              <li key={p.path} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span
                    className="min-w-0 truncate font-mono text-foreground/90"
                    title={p.path}
                  >
                    {p.path}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {p.visits}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </aside>
  )
}

function makeInitials(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "?"
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) {
    return trimmed.slice(0, 2).toUpperCase()
  }
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase()
}

function primaryLanguage(value: string) {
  const first = value.split(",")[0]?.trim()
  if (!first) return value
  return first.split(";")[0] ?? first
}

/** Lightweight UA sniff — we just need a readable label for the dashboard. */
function parseUserAgent(
  ua: string,
  unknown: string,
): { browser: string; os: string } {
  if (!ua) return { browser: unknown, os: unknown }

  const lower = ua.toLowerCase()

  let browser = unknown
  if (lower.includes("edg/")) browser = "Edge"
  else if (lower.includes("opr/") || lower.includes("opera"))
    browser = "Opera"
  else if (lower.includes("yabrowser")) browser = "Yandex"
  else if (lower.includes("chrome")) browser = "Chrome"
  else if (lower.includes("firefox")) browser = "Firefox"
  else if (lower.includes("safari")) browser = "Safari"

  let os = unknown
  if (lower.includes("windows")) os = "Windows"
  else if (lower.includes("android")) os = "Android"
  else if (lower.includes("iphone") || lower.includes("ipad")) os = "iOS"
  else if (lower.includes("mac os x") || lower.includes("macintosh"))
    os = "macOS"
  else if (lower.includes("linux")) os = "Linux"

  return { browser, os }
}

function timeAgo(iso: string, t: ReturnType<typeof useAdminI18n>) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "—"
  const diff = Date.now() - then
  const sec = Math.round(diff / 1000)
  if (sec < 60) return tf(t.timeAgoS, { n: sec })
  const min = Math.round(sec / 60)
  if (min < 60) return tf(t.timeAgoM, { n: min })
  const hr = Math.round(min / 60)
  if (hr < 24) return tf(t.timeAgoH, { n: hr })
  const day = Math.round(hr / 24)
  if (day < 7) return tf(t.timeAgoD, { n: day })
  return new Date(iso).toLocaleDateString()
}

function formatDateTime(iso: string, lang: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(lang, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}
