"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { AdminBillingOverview } from "@/components/admin/billing/billing-overview"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { useI18n, type DictKey } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  PAY_METERS,
  SUPPORTED_PAY_PAIRS,
  type BillingSettings,
  type PayMeter,
} from "@/lib/billing/types"
import { cn } from "@/lib/utils"

/**
 * «Тарифы» — распоряжения о деньгах для всего сайта.
 *
 * Все правки действуют только вперёд: в транзакции лежит применённая ставка, а
 * не ссылка на текущую. Поэтому форма ничего не пересчитывает задним числом и
 * не показывает, «как было бы» — это привело бы к ожиданию, что прошлое можно
 * переиграть.
 */

/** Подписи пар — по одному ключу словаря на пару, а не склейка из двух осей. */
const PAIR_LABEL: Record<(typeof SUPPORTED_PAY_PAIRS)[number], DictKey> = {
  "output:sec": "billingPairOutputSec",
  "output:count": "billingPairOutputCount",
  "source:count": "billingPairSourceCount",
  "source:bytes": "billingPairSourceBytes",
  "render:sec": "billingPairRenderSec",
  fixed: "billingPairFixed",
}

const METER_LABEL: Record<PayMeter, DictKey> = {
  sec: "billingMeterSec",
  count: "billingMeterCount",
  bytes: "billingMeterBytes",
}

function centsToRubles(cents: number | undefined): string {
  if (cents == null) return ""
  return String(cents / 100)
}

function rublesToCents(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".")
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card className="border-border/60 bg-card">
      <CardHeader className="gap-1.5">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
        {description ? (
          <CardDescription className="max-w-3xl text-sm leading-relaxed">
            {description}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  placeholder,
  className,
}: {
  id: string
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="max-w-xs"
      />
      {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  )
}

export function AdminBillingContent() {
  const { t } = useI18n()
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [revision, setRevision] = useState(0)
  const [saving, setSaving] = useState(false)
  /**
   * Ставки держим строками, а не числами: пустое поле означает «пара не
   * тарифицируется», и приведение к числу на каждом нажатии стёрло бы разницу
   * между пустым и нулём.
   */
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/settings", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as {
        settings: BillingSettings
        revision: number
      }
      setSettings(data.settings)
      setRevision(data.revision)
      setRateDrafts(
        Object.fromEntries(
          SUPPORTED_PAY_PAIRS.map((pair) => [
            pair,
            centsToRubles(data.settings.rates[pair]),
          ]),
        ),
      )
    } catch {
      toast.error(t.billingLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const patch = (next: Partial<BillingSettings>) =>
    setSettings((prev) => (prev ? { ...prev, ...next } : prev))

  const save = async () => {
    if (!settings) return
    setSaving(true)
    try {
      const rates: Record<string, number> = {}
      for (const pair of SUPPORTED_PAY_PAIRS) {
        const cents = rublesToCents(rateDrafts[pair] ?? "")
        if (cents != null) rates[pair] = cents
      }

      const res = await fetch("/api/admin/billing/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { ...settings, rates },
          baseRevision: revision,
        }),
      })

      if (res.status === 409) {
        // Ревизия разошлась — показываем актуальное, а не молча перетираем
        // чужую правку своей формой.
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

  if (!settings) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  const s = settings

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.billingEyebrow}
        title={t.billingTitle}
        description={t.billingDesc}
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

      <Section title={t.billingRatesTitle} description={t.billingRatesDesc}>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SUPPORTED_PAY_PAIRS.map((pair) => (
            <NumberField
              key={pair}
              id={`rate-${pair}`}
              label={t[PAIR_LABEL[pair]]}
              value={rateDrafts[pair] ?? ""}
              placeholder="—"
              onChange={(next) =>
                setRateDrafts((prev) => ({ ...prev, [pair]: next }))
              }
            />
          ))}
        </div>
      </Section>

      <Section title={t.billingMarginTitle}>
        <NumberField
          id="margin"
          label={t.billingMarginPct}
          hint={t.billingMarginDesc}
          value={String(s.marginPct)}
          onChange={(next) => patch({ marginPct: Number(next) || 0 })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            id="vendor-currency"
            label={t.billingVendorCurrency}
            value={s.vendorCurrency}
            onChange={(next) => patch({ vendorCurrency: next.toUpperCase() })}
          />
          <NumberField
            id="fx-adjust"
            label={t.billingFxAdjust}
            hint={t.billingFxDesc}
            value={String(s.fxAdjustPct)}
            onChange={(next) => patch({ fxAdjustPct: Number(next) || 0 })}
          />
        </div>
      </Section>

      <Section title={t.billingLimitsTitle}>
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">{t.billingMinAdmit}</p>
          <p className="max-w-3xl text-xs text-muted-foreground/80">
            {t.billingMinAdmitDesc}
          </p>
          <div className="grid gap-4 pt-1 sm:grid-cols-3">
            {PAY_METERS.map((meter) => (
              <NumberField
                key={meter}
                id={`min-${meter}`}
                label={t[METER_LABEL[meter]]}
                value={String(s.minAdmitUnits[meter])}
                onChange={(next) =>
                  patch({
                    minAdmitUnits: {
                      ...s.minAdmitUnits,
                      [meter]: Number(next) || 0,
                    },
                  })
                }
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5 pt-2">
          <p className="text-sm text-muted-foreground">
            {t.billingDefaultEstimate}
          </p>
          <p className="max-w-3xl text-xs text-muted-foreground/80">
            {t.billingDefaultEstimateDesc}
          </p>
          <div className="grid gap-4 pt-1 sm:grid-cols-3">
            {PAY_METERS.map((meter) => (
              <NumberField
                key={meter}
                id={`estimate-${meter}`}
                label={t[METER_LABEL[meter]]}
                value={String(s.defaultEstimateUnits[meter])}
                onChange={(next) =>
                  patch({
                    defaultEstimateUnits: {
                      ...s.defaultEstimateUnits,
                      [meter]: Number(next) || 0,
                    },
                  })
                }
              />
            ))}
          </div>
        </div>

        <NumberField
          id="overdraft"
          label={t.billingOverdraft}
          hint={t.billingOverdraftDesc}
          value={centsToRubles(s.overdraftLimitCents)}
          onChange={(next) =>
            patch({ overdraftLimitCents: rublesToCents(next) ?? 0 })
          }
        />
      </Section>

      <Section title={t.billingTrialTitle} description={t.billingTrialDesc}>
        <div className="flex items-center gap-3">
          <Switch
            id="trial-enabled"
            checked={s.trial.enabled}
            onCheckedChange={(checked) =>
              patch({ trial: { ...s.trial, enabled: checked } })
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
            value={centsToRubles(s.trial.amountCents)}
            onChange={(next) =>
              patch({
                trial: { ...s.trial, amountCents: rublesToCents(next) ?? 0 },
              })
            }
          />
          <NumberField
            id="trial-lifetime"
            label={t.billingTrialLifetime}
            hint={t.billingTrialLifetimeHint}
            value={s.trial.lifetimeDays == null ? "" : String(s.trial.lifetimeDays)}
            onChange={(next) => {
              const value = Number(next.trim())
              patch({
                trial: {
                  ...s.trial,
                  lifetimeDays:
                    next.trim() && Number.isFinite(value) && value > 0
                      ? Math.round(value)
                      : null,
                },
              })
            }}
          />
        </div>
      </Section>

      <AdminBillingOverview />

      <Section title={t.billingEnforceTitle} description={t.billingEnforceDesc}>
        <div className="flex items-center gap-3">
          <Switch
            id="enforce"
            checked={s.enforceForOwnProjects}
            onCheckedChange={(checked) =>
              patch({ enforceForOwnProjects: checked })
            }
          />
          <Label htmlFor="enforce" className="text-sm font-normal">
            {t.billingEnforceTitle}
          </Label>
        </div>
      </Section>
    </div>
  )
}
