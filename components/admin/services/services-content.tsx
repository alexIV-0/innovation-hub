"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronRight, KeyRound, Link2, Loader2, Plug, Plus } from "lucide-react"
import { toast } from "sonner"
import { formatBalance, tf, useI18n, type DictKey } from "@/components/account/i18n"
import { NumberField, Section, rublesToCents } from "@/components/admin/billing/fields"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { VENDOR_CURRENCIES } from "@/lib/billing/types"
import { slugify } from "@/lib/vault/slug"
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
  /** Пусто — адрес зашит в самой ноде (О5). */
  baseUrl: string
  billingModel: VendorBillingModel
  currency: string
  delivery: VendorDelivery
  keyTtlSec: number
  dailyCapCents: number
  status: "active" | "paused" | "revoked"
  /** Из чего состоит секрет учётки: `apiKey` либо `login` + `password`. */
  secretFields: { key: string; label: string; secret: boolean }[]
  accounts: Account[]
  prices: { unit: PriceUnit; priceMicros: number; effectiveFrom: string }[]
  spentMonthCents: number
}

/**
 * Учётка под сервисом. Их несколько, потому что на одном вендоре живут «тест и
 * прод», а клиент может принести свой ключ — и тогда расход его, а не наш.
 */
type Account = {
  id: string
  serviceId: string
  label: string
  ownerUserId: string | null
  ownerEmail: string | null
  status: "active" | "paused" | "revoked"
  createdAt: string
  updatedAt: string
  secret: { version: number; hint: string; createdAt: string } | null
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
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlDraft, setUrlDraft] = useState(service.baseUrl)
  const [unit, setUnit] = useState<PriceUnit>("token")
  const [price, setPrice] = useState("")

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

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
        {service.baseUrl ? (
          <span className="font-mono text-[11px]">{service.baseUrl}</span>
        ) : null}
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

      {/* Учётки: подсказка, версия и владелец. Самих полей секрета здесь нет
          и быть не может — наружу они уходят только машинам. */}
      <AccountsBlock service={service} busy={busy} lang={lang} onReload={onReload} />

      {/* Адрес правится здесь, а не только при заведении: смена эндпоинта у
          вендора не должна означать обход парка. Ревизия сейфа поднимется, и
          машины заберут новый адрес блоком `services`. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5">
        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        {editingUrl ? (
          <>
            <Input
              value={urlDraft}
              onChange={(event) => setUrlDraft(event.target.value)}
              autoComplete="off"
              placeholder="https://comfy.example.com"
              className="max-w-md"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={async () => {
                await onPatch(service.id, { baseUrl: urlDraft.trim() })
                setEditingUrl(false)
              }}
            >
              {t.billingSave}
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm">
              {service.baseUrl ? (
                <span className="font-mono">{service.baseUrl}</span>
              ) : (
                <span className="text-muted-foreground">{t.servicesNoBaseUrl}</span>
              )}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => {
                setUrlDraft(service.baseUrl)
                setEditingUrl(true)
              }}
            >
              {t.servicesEditBaseUrl}
            </Button>
          </>
        )}
      </div>

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

/**
 * Форма заведения сервиса.
 *
 * На первом экране три поля: название, валюта и ключ. Остальное — под
 * «Дополнительно», и не потому, что неважно, а потому, что у всего остального
 * есть верный по умолчанию ответ (`prepaid`, `keys`, 6 часов, без потолка).
 * Восемь полей подряд читаются как восемь решений, которых на самом деле нет.
 */
/**
 * Учётки сервиса.
 *
 * Отдельным компонентом, а не куском карточки: у каждой строки своё состояние
 * ротации, и держи мы его в карточке — открытие одной формы открывало бы все.
 *
 * Значений секрета здесь нет ни в каком виде: наружу они уходят ровно из одного
 * места, и это выдача машинам.
 */
function AccountsBlock({
  service,
  busy,
  lang,
  onReload,
}: {
  service: Service
  busy: boolean
  lang: "ru" | "en"
  onReload: () => Promise<void>
}) {
  const { t } = useI18n()
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-normal text-muted-foreground">
          {t.servicesAccounts}
        </Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAdding((prev) => !prev)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t.servicesAccountAdd}
        </Button>
      </div>

      {service.accounts.length === 0 ? (
        <p className="text-xs text-muted-foreground/80">{t.servicesAccountsEmpty}</p>
      ) : (
        <div className="space-y-2">
          {service.accounts.map((account) => (
            <AccountRow
              key={account.id}
              service={service}
              account={account}
              busy={busy}
              lang={lang}
              onReload={onReload}
            />
          ))}
        </div>
      )}

      {adding ? (
        <AccountForm
          service={service}
          onDone={async () => {
            setAdding(false)
            await onReload()
          }}
        />
      ) : null}
    </div>
  )
}

/** Одна учётка: подсказка, версия, владелец, расход и её команды. */
function AccountRow({
  service,
  account,
  busy,
  lang,
  onReload,
}: {
  service: Service
  account: Account
  busy: boolean
  lang: "ru" | "en"
  onReload: () => Promise<void>
}) {
  const { t } = useI18n()
  const [rotating, setRotating] = useState(false)

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  const call = async (path: string, init: RequestInit, done: (body: never) => void) => {
    try {
      const res = await fetch(
        `/api/admin/services/${service.id}/accounts/${account.id}${path}`,
        init,
      )
      if (!res.ok) throw new Error(String(res.status))
      done((await res.json()) as never)
      await onReload()
    } catch {
      toast.error(t.servicesSaveError)
    }
  }

  const retireOld = () =>
    call("/secret", { method: "DELETE" }, (body: { revoked: number }) => {
      toast.success(tf(t.servicesRevokedOld, { count: body.revoked }))
    })

  return (
    <div className="space-y-2 rounded-lg border border-border/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{account.label}</span>

        {/* Чья учётка — самое важное в строке: от этого зависит, попадёт её
            расход в себестоимость ролика или нет. */}
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px]",
            account.ownerUserId ? "bg-amber-500/15 text-amber-500" : "bg-muted/60",
          )}
        >
          {account.ownerUserId
            ? tf(t.servicesAccountOwned, { email: account.ownerEmail ?? "—" })
            : t.servicesAccountOurs}
        </span>

        {account.status !== "active" ? (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px]">
            {t[STATUS_KEY[account.status]]}
          </span>
        ) : null}

        <span className="text-sm">
          {account.secret ? (
            <>
              <span className="font-mono">{account.secret.hint}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {tf(t.servicesKeyVersion, {
                  version: account.secret.version,
                  date: date(account.secret.createdAt),
                })}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t.servicesNoKey}</span>
          )}
        </span>

        <span className="ml-auto text-xs text-muted-foreground">
          {formatBalance(account.spentMonthCents, lang)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRotating((prev) => !prev)}
        >
          {account.secret ? t.servicesRotate : t.servicesSetKey}
        </Button>
        {(account.secret?.version ?? 0) > 1 ? (
          <Button type="button" variant="ghost" size="sm" onClick={retireOld}>
            {t.servicesRevokeOld}
          </Button>
        ) : null}
        {account.status === "active" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              call("", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "paused" }),
              }, () => toast.success(t.servicesSaved))
            }
          >
            {t.servicesPause}
          </Button>
        ) : account.status === "paused" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() =>
              call("", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "active" }),
              }, () => toast.success(t.servicesSaved))
            }
          >
            {t.servicesResume}
          </Button>
        ) : null}
        {account.status !== "revoked" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t.servicesAccountRevokeConfirm)) return
              void call("", { method: "DELETE" }, () =>
                toast.success(t.servicesSaved),
              )
            }}
          >
            {t.servicesRevoke}
          </Button>
        ) : null}
      </div>

      {rotating ? (
        <SecretFields
          service={service}
          hint={t.servicesRotateHint}
          submitLabel={t.servicesRotate}
          onSubmit={async (fields) => {
            await call(
              "/secret",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fields }),
              },
              (body: { version: number }) => {
                toast.success(tf(t.servicesRotated, { version: body.version }))
                setRotating(false)
              },
            )
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * Поля секрета по описанию сервиса.
 *
 * Форма одна на все сервисы и рисуется по данным, а не по коду: новый вендор с
 * парой `client_id` + `client_secret` — это строка в каталоге, а не новое окно.
 */
function SecretFields({
  service,
  hint,
  submitLabel,
  onSubmit,
}: {
  service: Service
  hint: string
  submitLabel: string
  onSubmit: (fields: Record<string, string>) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const specs =
    service.secretFields.length > 0
      ? service.secretFields
      : [{ key: "apiKey", label: "", secret: true }]

  const filled = specs.every((spec) => (values[spec.key] ?? "").trim().length > 0)

  return (
    <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap items-end gap-2">
        {specs.map((spec) => (
          <div key={spec.key} className="space-y-1">
            <Label className="text-xs font-normal text-muted-foreground">
              {spec.label || spec.key}
            </Label>
            <Input
              value={values[spec.key] ?? ""}
              onChange={(event) =>
                setValues((prev) => ({ ...prev, [spec.key]: event.target.value }))
              }
              // Логин прятать незачем — прячем только то, что объявлено секретом.
              type={spec.secret ? "password" : "text"}
              autoComplete="off"
              className="max-w-xs"
            />
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          disabled={!filled}
          onClick={() => void onSubmit(values)}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

/** Заведение учётки: метка, владелец почтой и поля секрета. */
function AccountForm({
  service,
  onDone,
}: {
  service: Service
  onDone: () => Promise<void>
}) {
  const { t } = useI18n()
  const [label, setLabel] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")

  const submit = async (fields: Record<string, string>) => {
    try {
      const res = await fetch(`/api/admin/services/${service.id}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          ownerEmail: ownerEmail.trim() || null,
          fields,
        }),
      })
      if (res.status === 409) {
        toast.error(t.servicesAccountLabelTaken)
        return
      }
      if (res.status === 404) {
        toast.error(t.servicesAccountOwnerMissing)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.servicesAccountCreated)
      await onDone()
    } catch {
      toast.error(t.servicesSaveError)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-normal text-muted-foreground">
            {t.servicesAccountLabel}
          </Label>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoComplete="off"
            placeholder="main"
            className="max-w-[12rem]"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-normal text-muted-foreground">
            {t.servicesAccountOwner}
          </Label>
          <Input
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.target.value)}
            autoComplete="off"
            placeholder={t.servicesAccountOwnerPlaceholder}
            className="max-w-[18rem]"
          />
        </div>
      </div>
      <p className="max-w-2xl text-xs text-muted-foreground/80">
        {t.servicesAccountOwnerHint}
      </p>
      <SecretFields
        service={service}
        hint={t.servicesAccountSecretHint}
        submitLabel={t.servicesAccountCreate}
        onSubmit={async (fields) => {
          if (!label.trim()) return
          await submit(fields)
        }}
      />
    </div>
  )
}

function CreateForm({ onDone }: { onDone: () => Promise<void> }) {
  const { t } = useI18n()
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  /**
   * Слаг правили руками — именем его больше не перетираем. Человек мог подогнать
   * его под то, чего уже ждёт нода, и потерять эту правку дороже, чем набрать
   * слаг заново.
   */
  const [slugTouched, setSlugTouched] = useState(false)
  const [adapter, setAdapter] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [currency, setCurrency] = useState("USD")
  const [model, setModel] = useState<VendorBillingModel>("prepaid")
  const [delivery, setDelivery] = useState<VendorDelivery>("keys")
  const [ttlHours, setTtlHours] = useState("6")
  const [cap, setCap] = useState("")
  const [secret, setSecret] = useState("")
  const [fieldKeys, setFieldKeys] = useState("")
  const [more, setMore] = useState(false)
  const [saving, setSaving] = useState(false)

  const effectiveSlug = slugTouched ? slug.trim() : slugify(name)

  /**
   * Состав секрета из строки «login, password». Пусто — одно поле `apiKey`.
   *
   * Список, а не редактор полей: у подавляющего большинства вендоров поле одно,
   * и полноценный конструктор ради редкого случая читался бы дольше, чем сам
   * случай встречается.
   */
  const specs = (() => {
    const keys = fieldKeys
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
    return keys.length > 0
      ? keys.map((key) => ({ key, label: "", secret: true }))
      : [{ key: "apiKey", label: "", secret: true }]
  })()

  const submit = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/admin/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          adapter: adapter.trim(),
          baseUrl: baseUrl.trim(),
          currency,
          billingModel: model,
          delivery,
          keyTtlSec: Math.max(60, Math.round(Number(ttlHours || "6") * 3600)),
          dailyCapCents: cap.trim() ? (rublesToCents(cap) ?? 0) : 0,
          secretFields: specs,
          // Первая учётка заводится сразу, если ключ введён. Без ключа сервис
          // остаётся без учёток — законный случай для своего сервиса рядом.
          account: secret.trim()
            ? { label: "main", fields: { [specs[0]!.key]: secret.trim() } }
            : null,
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
          <Input
            id="svc-name"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {/* Слаг показан сразу, а не спрятан целиком: поменять его после
              создания нельзя, и увидеть его надо ДО нажатия «Завести». */}
          {effectiveSlug ? (
            <p className="text-xs text-muted-foreground/80">
              {tf(t.servicesSlugAuto, { slug: effectiveSlug })}
            </p>
          ) : null}
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
              {VENDOR_CURRENCIES.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground/80">{t.servicesFieldCurrencyHint}</p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="svc-url" className="text-sm font-normal text-muted-foreground">
            {t.servicesFieldBaseUrl}
          </Label>
          <Input
            id="svc-url"
            autoComplete="off"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://comfy.example.com"
            className="max-w-xl"
          />
          <p className="text-xs text-muted-foreground/80">{t.servicesFieldBaseUrlHint}</p>
        </div>
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

      <Collapsible open={more} onOpenChange={setMore}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-150",
                more && "rotate-90",
              )}
            />
            {t.servicesMore}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="max-w-3xl py-3 text-xs text-muted-foreground/80">
            {t.servicesMoreHint}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="svc-slug" className="text-sm font-normal text-muted-foreground">
                {t.servicesFieldSlug}
              </Label>
              <Input
                id="svc-slug"
                autoComplete="off"
                value={effectiveSlug}
                onChange={(e) => {
                  setSlugTouched(true)
                  setSlug(e.target.value.toLowerCase())
                }}
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
                autoComplete="off"
                value={adapter}
                onChange={(e) => setAdapter(e.target.value)}
              />
              <p className="text-xs text-muted-foreground/80">{t.servicesFieldAdapterHint}</p>
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
            <div className="space-y-1.5">
              <Label
                htmlFor="svc-fields"
                className="text-sm font-normal text-muted-foreground"
              >
                {t.servicesFieldSecretFields}
              </Label>
              <Input
                id="svc-fields"
                autoComplete="off"
                value={fieldKeys}
                onChange={(e) => setFieldKeys(e.target.value)}
                placeholder="apiKey"
              />
              <p className="text-xs text-muted-foreground/80">
                {t.servicesFieldSecretFieldsHint}
              </p>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button
        type="button"
        onClick={submit}
        // Ключ больше не обязателен: свой сервис может не требовать
        // авторизации. Но заполненный наполовину — обязателен целиком, иначе
        // обрезанный ключ уедет на машину и упадёт уже у вендора.
        disabled={
          saving ||
          !name.trim() ||
          !effectiveSlug ||
          (secret.trim().length > 0 && secret.trim().length < 8)
        }
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
