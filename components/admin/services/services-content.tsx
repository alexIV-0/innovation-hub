"use client"

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Loader2, Plug, Plus } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, tf, useI18n, type DictKey } from "@/components/account/i18n"
import { NumberField, Section, rublesToCents } from "@/components/admin/billing/fields"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VENDOR_CURRENCIES } from "@/lib/billing/types"
import {
  BILLING_MODELS,
  DELIVERIES,
  PRICE_SCALE,
  PRICE_UNITS,
  type PriceUnit,
  type VendorBillingModel,
  type VendorDelivery,
} from "@/lib/vault/types"
import { cn } from "@/lib/utils"

/**
 * «Внешние сервисы» — сейф.
 *
 * Экран показывает МЕТАДАННЫЕ ключа и никогда сам ключ: версию, подсказку
 * «••••4f21», дату. Кнопки «показать» здесь нет и не будет — её отсутствие
 * честнее иллюзии контроля, а достать ключ можно ровно одним способом: быть
 * машиной с живым токеном и попросить его через `vendorKeys`.
 *
 * Разбор решений — docs/VENDOR_SERVICES_PLAN.md.
 */

type Service = {
  id: string
  slug: string
  name: string
  adapter: string
  billingModel: VendorBillingModel
  currency: string
  delivery: VendorDelivery
  keyTtlSec: number
  dailyCapCents: number
  status: "active" | "paused" | "revoked"
  secret: { version: number; hint: string; createdAt: string } | null
  prices: { unit: PriceUnit; priceMicros: number; effectiveFrom: string }[]
  spentMonthCents: number
}

const MODEL_KEY: Record<VendorBillingModel, DictKey> = {
  prepaid: "servicesModelPrepaid",
  postpaid: "servicesModelPostpaid",
  subscription: "servicesModelSubscription",
}

const DELIVERY_KEY: Record<VendorDelivery, DictKey> = {
  keys: "servicesDeliveryKeys",
  proxy: "servicesDeliveryProxy",
}

const STATUS_KEY: Record<Service["status"], DictKey> = {
  active: "servicesStatusActive",
  paused: "servicesStatusPaused",
  revoked: "servicesStatusRevoked",
}

const UNIT_KEY: Record<PriceUnit, DictKey> = {
  token: "servicesUnitToken",
  char: "servicesUnitChar",
  sec: "servicesUnitSec",
  image: "servicesUnitImage",
  run: "servicesUnitRun",
}

/** Валюты прайса: те же, в которых вендоры выставляют счёт, плюс рубль. */
const CURRENCIES = [...VENDOR_CURRENCIES, "RUB"]

export function AdminServices() {
  const { t, lang } = useI18n()
  const [services, setServices] = useState<Service[] | null>(null)
  const [vaultReady, setVaultReady] = useState(true)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/services", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as {
        services: Service[]
        vaultConfigured: boolean
      }
      setServices(body.services)
      setVaultReady(body.vaultConfigured)
    } catch {
      toast.error(t.servicesLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(String(res.status))
      await load()
    } catch {
      toast.error(t.servicesSaveError)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.servicesEyebrow}
        title={t.servicesTitle}
        description={t.servicesSub}
        actions={
          <Button
            type="button"
            onClick={() => setAdding((prev) => !prev)}
            disabled={!vaultReady}
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {t.servicesAdd}
          </Button>
        }
      />

      {/* Отсутствие мастер-ключа говорится ДО формы: иначе человек введёт ключ
          вендора и получит отказ на кнопке «Завести». */}
      {!vaultReady ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {t.servicesVaultMissing}
        </div>
      ) : null}

      {adding ? (
        <CreateForm
          onDone={async () => {
            setAdding(false)
            await load()
          }}
        />
      ) : null}

      {services == null ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : services.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.servicesEmpty}</p>
      ) : (
        <div className="space-y-4">
          {services.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              busy={busy === service.id}
              lang={lang}
              onPatch={patch}
              onReload={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ServiceCard({
  service,
  busy,
  lang,
  onPatch,
  onReload,
}: {
  service: Service
  busy: boolean
  lang: "ru" | "en"
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>
  onReload: () => Promise<void>
}) {
  const { t } = useI18n()
  const [rotating, setRotating] = useState(false)
  const [secret, setSecret] = useState("")
  const [unit, setUnit] = useState<PriceUnit>("token")
  const [price, setPrice] = useState("")

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  const rotate = async () => {
    if (secret.trim().length < 8) return
    try {
      const res = await fetch(`/api/admin/services/${service.id}/secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: secret.trim() }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { version: number }
      toast.success(tf(t.servicesRotated, { version: body.version }))
      setSecret("")
      setRotating(false)
      await onReload()
    } catch {
      toast.error(t.servicesSaveError)
    }
  }

  const retireOld = async () => {
    try {
      const res = await fetch(`/api/admin/services/${service.id}/secret`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as { revoked: number }
      toast.success(tf(t.servicesRevokedOld, { count: body.revoked }))
      await onReload()
    } catch {
      toast.error(t.servicesSaveError)
    }
  }

  const addPrice = async () => {
    // Цена вводится в валюте сервиса, хранится в микроединицах: 0.000002 в
    // центах округлилось бы в ноль, и потребление стало бы бесплатным.
    const value = Number(price.trim().replace(",", "."))
    if (!Number.isFinite(value) || value < 0) return
    try {
      const res = await fetch(`/api/admin/services/${service.id}/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit, priceMicros: Math.round(value * PRICE_SCALE) }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.servicesPriceSaved)
      setPrice("")
      await onReload()
    } catch {
      toast.error(t.servicesSaveError)
    }
  }

  return (
    <Section title={service.name}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px]">
          {service.slug}
        </span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px]",
            service.status === "active"
              ? "bg-primary/15 text-primary"
              : "bg-muted/60",
          )}
        >
          {t[STATUS_KEY[service.status]]}
        </span>
        <span>{service.currency}</span>
        <span>{t[MODEL_KEY[service.billingModel]]}</span>
        <span>{t[DELIVERY_KEY[service.delivery]]}</span>
        <span>
          {tf(t.servicesTtlHours, { hours: Math.round(service.keyTtlSec / 3600) })}
        </span>
        <span>
          {service.dailyCapCents > 0
            ? formatBalance(service.dailyCapCents, lang)
            : t.servicesCapNone}
        </span>
        <span className="ml-auto">
          {t.servicesSpentMonth}: {formatBalance(service.spentMonthCents, lang)}
        </span>
      </div>

      {/* Ключ: версия и подсказка. Самого ключа здесь нет и быть не может. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm">
          {service.secret ? (
            <>
              <span className="font-mono">{service.secret.hint}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {tf(t.servicesKeyVersion, {
                  version: service.secret.version,
                  date: date(service.secret.createdAt),
                })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t.servicesNoKey}</span>
          )}
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRotating((prev) => !prev)}
          >
            {t.servicesRotate}
          </Button>
          {(service.secret?.version ?? 0) > 1 ? (
            <Button type="button" variant="ghost" size="sm" onClick={retireOld}>
              {t.servicesRevokeOld}
            </Button>
          ) : null}
        </div>
      </div>

      {rotating ? (
        <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
          <p className="text-xs text-muted-foreground">{t.servicesRotateHint}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              type="password"
              autoComplete="off"
              className="max-w-md"
            />
            <Button type="button" size="sm" onClick={rotate}>
              {t.servicesRotate}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Прайс: без него потребление записать нечем, и это сказано прямо. */}
      <div className="space-y-2">
        <Label className="text-sm font-normal text-muted-foreground">
          {t.servicesPrices}
        </Label>
        {service.prices.length === 0 ? (
          <p className="text-xs text-muted-foreground/80">{t.servicesPricesEmpty}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {service.prices.map((row) => (
              <li
                key={row.unit}
                className="rounded-md border border-border/60 px-2.5 py-1 text-xs"
              >
                {t[UNIT_KEY[row.unit]]}:{" "}
                <span className="font-mono">
                  {(row.priceMicros / PRICE_SCALE).toFixed(6)} {service.currency}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <Select value={unit} onValueChange={(next) => setUnit(next as PriceUnit)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRICE_UNITS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t[UNIT_KEY[value]]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder="0.000000"
            className="w-40"
          />
          <Button type="button" variant="outline" size="sm" onClick={addPrice}>
            {t.servicesPriceAdd}
          </Button>
          <span className="text-xs text-muted-foreground/80">
            {t.servicesPriceHint}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {service.status === "active" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onPatch(service.id, { status: "paused" })}
          >
            {t.servicesPause}
          </Button>
        ) : service.status === "paused" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onPatch(service.id, { status: "active" })}
          >
            {t.servicesResume}
          </Button>
        ) : null}
        {service.status !== "revoked" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t.servicesRevokeConfirm)) return
              void onPatch(service.id, { status: "revoked" })
            }}
          >
            {t.servicesRevoke}
          </Button>
        ) : null}
      </div>
    </Section>
  )
}

function CreateForm({ onDone }: { onDone: () => Promise<void> }) {
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [adapter, setAdapter] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [model, setModel] = useState<VendorBillingModel>("prepaid")
  const [delivery, setDelivery] = useState<VendorDelivery>("keys")
  const [ttlHours, setTtlHours] = useState("6")
  const [cap, setCap] = useState("")
  const [secret, setSecret] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          adapter: adapter.trim(),
          currency,
          billingModel: model,
          delivery,
          keyTtlSec: Math.max(60, Math.round(Number(ttlHours || "6") * 3600)),
          dailyCapCents: cap.trim() ? (rublesToCents(cap) ?? 0) : 0,
          secret: secret.trim(),
        }),
      })
      if (res.status === 409) {
        toast.error(t.servicesSlugTaken)
        return
      }
      if (res.status === 503) {
        toast.error(t.servicesVaultError)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.servicesCreated)
      await onDone()
    } catch {
      toast.error(t.servicesSaveError)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title={t.servicesAddTitle}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="svc-name" className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldName}
          </Label>
          <Input id="svc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="svc-slug" className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldSlug}
          </Label>
          <Input
            id="svc-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            placeholder="eleven-labs"
          />
          <p className="text-xs text-muted-foreground/80">{t.servicesFieldSlugHint}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="svc-adapter" className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldAdapter}
          </Label>
          <Input
            id="svc-adapter"
            value={adapter}
            onChange={(e) => setAdapter(e.target.value)}
          />
          <p className="text-xs text-muted-foreground/80">{t.servicesFieldAdapterHint}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldCurrency}
          </Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground/80">{t.servicesFieldCurrencyHint}</p>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldModel}
          </Label>
          <Select
            value={model}
            onValueChange={(next) => setModel(next as VendorBillingModel)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BILLING_MODELS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t[MODEL_KEY[value]]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldDelivery}
          </Label>
          <Select
            value={delivery}
            onValueChange={(next) => setDelivery(next as VendorDelivery)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DELIVERIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t[DELIVERY_KEY[value]]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NumberField
          id="svc-ttl"
          label={t.servicesFieldTtl}
          hint={t.servicesFieldTtlHint}
          value={ttlHours}
          onChange={setTtlHours}
        />
        <NumberField
          id="svc-cap"
          label={t.servicesFieldCap}
          hint={t.servicesFieldCapHint}
          value={cap}
          onChange={setCap}
        />
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="svc-secret" className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldSecret}
          </Label>
          <Input
            id="svc-secret"
            type="password"
            autoComplete="off"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="max-w-xl"
          />
          <p className="text-xs text-muted-foreground/80">{t.servicesFieldSecretHint}</p>
        </div>
      </div>

      <Button
        type="button"
        onClick={submit}
        disabled={saving || !name.trim() || !slug.trim() || secret.trim().length < 8}
      >
        {saving ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Plug className="mr-1.5 h-4 w-4" />
        )}
        {t.servicesCreate}
      </Button>
    </Section>
  )
}
