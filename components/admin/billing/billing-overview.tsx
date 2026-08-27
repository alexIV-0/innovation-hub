"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, useI18n } from "@/components/account/i18n"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Наблюдение в «Тарифах»: пробный набор, активации, проекты без единицы.
 *
 * Отдельным компонентом от формы тарифов: та про распоряжения, эта про
 * состояние. Смешав их, получим экран, где кнопка «Сохранить» относится к
 * половине содержимого.
 */

type TemplateRow = {
  projectId: string
  name: string
  templateOrder: number | null
  payBase: string | null
  payMeter: string | null
  cost: { centsPerSec: number | null; charges: number } | null
}

type ActivationRow = {
  grantId: string
  email: string
  fullName: string
  status: string
  amountCents: number
  remainingCents: number
  activatedAt: string
  registeredAt: string
  projectCount: number
}

type UnpricedRow = { projectId: string; name: string }

type Overview = {
  templates: TemplateRow[]
  activations: ActivationRow[]
  unpriced: UnpricedRow[]
}

type PickRow = {
  projectId: string
  name: string
  ownerEmail: string
  isTemplate: boolean
}

function Panel({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-6">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      <div className="mt-5">{children}</div>
    </section>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground/80">{text}</p>
}

export function AdminBillingOverview({ className }: { className?: string }) {
  const { t, lang } = useI18n()
  const [data, setData] = useState<Overview | null>(null)
  const [q, setQ] = useState("")
  const [picks, setPicks] = useState<PickRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/overview", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as Overview)
    } catch {
      toast.error(t.billingLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Поиск с задержкой: экран открывают, чтобы посмотреть набор, а не искать, и
  // запрос на каждую букву тут был бы платой ни за что.
  useEffect(() => {
    if (q.trim().length < 2) {
      setPicks([])
      return
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/billing/search?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        )
        if (!res.ok) return
        const body = (await res.json()) as { projects: PickRow[] }
        setPicks(body.projects)
      } catch {
        // Подсказка поиска — не то, ради чего показывают ошибку.
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  const setTemplate = async (projectId: string, isTemplate: boolean) => {
    setBusy(projectId)
    try {
      const res = await fetch(`/api/admin/billing/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isTemplate }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.billingSaved)
      setQ("")
      setPicks([])
      await load()
    } catch {
      toast.error(t.billingSaveError)
    } finally {
      setBusy(null)
    }
  }

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  if (!data) {
    return (
      <div className="flex min-h-[20vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className={cn("space-y-8", className)}>
      <Panel title={t.billingTemplatesTitle} description={t.billingTemplatesDesc}>
        {data.templates.length === 0 ? (
          <Empty text={t.billingTemplatesEmpty} />
        ) : (
          <ul className="divide-y divide-border/50">
            {data.templates.map((row) => (
              <li
                key={row.projectId}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {row.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.billingTemplateCost}:{" "}
                  {row.cost?.centsPerSec
                    ? formatBalance(Math.round(row.cost.centsPerSec), lang)
                    : t.billingTemplateNoCost}
                </span>
                <button
                  type="button"
                  disabled={busy === row.projectId}
                  onClick={() => setTemplate(row.projectId, false)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                  {t.billingTemplateRemove}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-4 text-xs text-muted-foreground/80">
          {t.billingTemplateCostHint}
        </p>

        <div className="mt-5 space-y-2">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder={t.billingTemplateSearch}
              className="pl-9"
            />
          </div>
          {picks.length > 0 ? (
            <ul className="max-w-md divide-y divide-border/50 rounded-lg border border-border/60">
              {picks.map((pick) => (
                <li
                  key={pick.projectId}
                  className="flex items-center gap-3 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {pick.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {pick.ownerEmail}
                    </span>
                  </span>
                  {pick.isTemplate ? null : (
                    <button
                      type="button"
                      disabled={busy === pick.projectId}
                      onClick={() => setTemplate(pick.projectId, true)}
                      className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary/15 px-2 py-1 text-xs text-primary hover:bg-primary/25 disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      {t.billingTemplateAdd}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Panel>

      <Panel
        title={t.billingActivationsTitle}
        description={t.billingActivationsDesc}
      >
        {data.activations.length === 0 ? (
          <Empty text={t.billingActivationsEmpty} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">{t.billingActivationUser}</th>
                  <th className="pb-2 font-medium">
                    {t.billingActivationRegistered}
                  </th>
                  <th className="pb-2 font-medium">
                    {t.billingActivationActivated}
                  </th>
                  <th className="pb-2 font-medium">{t.billingActivationLeft}</th>
                  <th className="pb-2 font-medium">
                    {t.billingActivationStatus}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data.activations.map((row) => (
                  <tr key={row.grantId}>
                    <td className="py-2.5 pr-4">
                      <div className="truncate text-foreground">{row.email}</div>
                      {row.fullName ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {row.fullName}
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {date(row.registeredAt)}
                    </td>
                    <td className="py-2.5 pr-4 text-muted-foreground">
                      {date(row.activatedAt)}
                    </td>
                    <td className="py-2.5 pr-4">
                      {formatBalance(row.remainingCents, lang)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        / {formatBalance(row.amountCents, lang)}
                      </span>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title={t.billingUnpricedTitle} description={t.billingUnpricedDesc}>
        {data.unpriced.length === 0 ? (
          <Empty text={t.billingUnpricedEmpty} />
        ) : (
          <ul className="divide-y divide-border/50">
            {data.unpriced.slice(0, 50).map((row) => (
              <li
                key={row.projectId}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                <Link
                  href="/admin/pipeline"
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  {t.billingUnpricedOpen}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
