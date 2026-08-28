"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Plus, Search, X } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, useI18n } from "@/components/account/i18n"
import {
  NumberField,
  Section,
  centsToRubles,
  rublesToCents,
} from "@/components/admin/billing/fields"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { TrialSettings } from "@/lib/billing/types"

/**
 * «Тестовый период» — отдельный инструмент со своим тегом `billing.trial`.
 *
 * Решение «дарим ли мы новым пользователям и сколько» маркетинговое, а прайс —
 * коммерческое, и доверять их можно разным людям. Поэтому здесь только четыре
 * вещи: включение кнопки, сумма, срок и состав набора. Ставки — в «Тарифах», и
 * сохранение отсюда их не трогает.
 */

type TemplateRow = {
  projectId: string
  name: string
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
}

type PickRow = {
  projectId: string
  name: string
  ownerEmail: string
  isTemplate: boolean
}

export function AdminBillingTrial() {
  const { t, lang } = useI18n()
  const [trial, setTrial] = useState<TrialSettings | null>(null)
  const [revision, setRevision] = useState(0)
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [activations, setActivations] = useState<ActivationRow[]>([])
  const [q, setQ] = useState("")
  const [picks, setPicks] = useState<PickRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/trial", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as {
        trial: TrialSettings
        revision: number
        templates: TemplateRow[]
        activations: ActivationRow[]
      }
      setTrial(data.trial)
      setRevision(data.revision)
      setTemplates(data.templates)
      setActivations(data.activations)
    } catch {
      toast.error(t.billingLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Поиск с задержкой: экран открывают, чтобы посмотреть набор, а не искать.
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

  const save = async () => {
    if (!trial) return
    setSaving(true)
    try {
      const res = await fetch("/api/admin/billing/trial", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trial, baseRevision: revision }),
      })
      if (res.status === 409) {
        toast.error(t.billingConflict)
        await load()
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { revision: number }
      setRevision(data.revision)
      toast.success(t.billingSaved)
    } catch {
      toast.error(t.billingSaveError)
    } finally {
      setSaving(false)
    }
  }

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

  if (!trial) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.billingEyebrow}
        title={t.adminBillingTrial}
        description={t.adminBillingTrialDesc}
        actions={
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t.billingSaving}
              </>
            ) : (
              t.billingSave
            )}
          </Button>
        }
      />

      <Section title={t.billingTrialTitle} description={t.billingTrialDesc}>
        <div className="flex items-center gap-3">
          <Switch
            id="trial-enabled"
            checked={trial.enabled}
            onCheckedChange={(checked) =>
              setTrial({ ...trial, enabled: checked })
            }
          />
          <Label htmlFor="trial-enabled" className="text-sm font-normal">
            {t.billingTrialEnabled}
          </Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="trial-amount"
            label={t.billingTrialAmount}
            value={centsToRubles(trial.amountCents)}
            onChange={(next) =>
              setTrial({ ...trial, amountCents: rublesToCents(next) ?? 0 })
            }
          />
          <NumberField
            id="trial-lifetime"
            label={t.billingTrialLifetime}
            hint={t.billingTrialLifetimeHint}
            value={trial.lifetimeDays == null ? "" : String(trial.lifetimeDays)}
            onChange={(next) => {
              const value = Number(next.trim())
              setTrial({
                ...trial,
                lifetimeDays:
                  next.trim() && Number.isFinite(value) && value > 0
                    ? Math.round(value)
                    : null,
              })
            }}
          />
        </div>
      </Section>

      <Section
        title={t.billingTemplatesTitle}
        description={t.billingTemplatesDesc}
      >
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground/80">
            {t.billingTemplatesEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {templates.map((row) => (
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

        <p className="text-xs text-muted-foreground/80">
          {t.billingTemplateCostHint}
        </p>

        <div className="space-y-2">
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
                <li key={pick.projectId} className="flex items-center gap-3 px-3 py-2">
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
      </Section>

      <Section
        title={t.billingActivationsTitle}
        description={t.billingActivationsDesc}
      >
        {activations.length === 0 ? (
          <p className="text-sm text-muted-foreground/80">
            {t.billingActivationsEmpty}
          </p>
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
                  <th className="pb-2 font-medium">{t.billingActivationStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {activations.map((row) => (
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
      </Section>
    </div>
  )
}
