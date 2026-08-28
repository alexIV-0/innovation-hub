"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import {
  SUPPORTED_PAY_PAIRS,
  type PayBase,
  type PayMeter,
} from "@/lib/billing/types"

/**
 * Проекты, у которых не задано, за что списывать средства.
 *
 * Отдельный инструмент, а не секция в «Тарифах»: это не распоряжение, а
 * незакрытый хвост, и смотреть его будут не тогда, когда правят цены, а тогда,
 * когда собираются включить проверку денег. Живёт в двух областях — деньги и
 * конвейер, — потому что искать будут в обеих.
 *
 * ⚠️ Список неполный, и это написано прямо на экране: оси мог объявить сам
 * граф. Выдать выборку за аудит значило бы обещать больше, чем она знает.
 */

type Row = {
  projectId: string
  name: string
  payBase: PayBase | null
  payMeter: PayMeter | null
}

export function AdminBillingUnpriced() {
  const { t } = useI18n()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/billing/unpriced", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { projects: Row[] }
      setRows(body.projects)
    } catch {
      toast.error(t.billingLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const setAxes = async (projectId: string, pair: string) => {
    const [base, meter] = pair === "fixed" ? ["fixed", null] : pair.split(":")
    setBusy(projectId)
    try {
      const res = await fetch(`/api/admin/billing/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payAxes: { base, meter: meter ?? null },
        }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.billingSaved)
      await load()
    } catch {
      toast.error(t.billingSaveError)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.billingEyebrow}
        title={t.adminBillingUnpriced}
        description={t.adminBillingUnpricedDesc}
      />

      <Section
        title={t.billingUnpricedTitle}
        description={t.billingUnpricedDesc}
      >
        {rows == null ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground/80">
            {t.billingUnpricedEmpty}
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rows.map((row) => (
              <li
                key={row.projectId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                {/* Задать единицу можно прямо здесь: список для того и есть,
                    чтобы его опустошить, а не чтобы ходить отсюда в другое
                    место и возвращаться. */}
                <select
                  disabled={busy === row.projectId}
                  defaultValue=""
                  onChange={(event) => {
                    if (event.target.value) setAxes(row.projectId, event.target.value)
                  }}
                  className="h-8 rounded-lg border border-border/60 bg-background px-2 text-xs text-foreground disabled:opacity-50"
                >
                  <option value="">—</option>
                  {SUPPORTED_PAY_PAIRS.map((pair) => (
                    <option key={pair} value={pair}>
                      {pair}
                    </option>
                  ))}
                </select>
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
      </Section>
    </div>
  )
}
