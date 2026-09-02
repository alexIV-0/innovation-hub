"use client"

import { useCallback, useEffect, useState } from "react"
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useI18n, tf } from "@/components/account/i18n"
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

/**
 * «Мои ключи» — учётки внешних сервисов, которые человек принёс сам.
 *
 * Ключ у него ОДИН НА ВСЕ ЕГО ПРОЕКТЫ: завёл однажды — работает везде. Поэтому
 * экран отдельный, а не поле внутри настроек проекта: иначе замена ключа
 * превращалась бы в «найди тот проект, где я его вводил».
 *
 * ⚠️ Секрет наружу не отдаётся никогда — даже владельцу. Видно `••••4f21`,
 * версию и дату; заменить можно, посмотреть нельзя.
 */

type OwnedAccount = {
  id: string
  serviceId: string
  serviceName: string
  serviceSlug: string
  label: string
  status: string
  createdAt: string
  secret: { version: number; hint: string; createdAt: string } | null
}

type ServiceOption = {
  id: string
  slug: string
  name: string
  secretFields: { key: string; label: string; secret: boolean }[]
}

export function VendorKeysPage() {
  const { t, lang } = useI18n()
  const [accounts, setAccounts] = useState<OwnedAccount[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [rotatingId, setRotatingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/vendor-keys", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as {
        accounts: OwnedAccount[]
        services: ServiceOption[]
      }
      setAccounts(body.accounts)
      setServices(body.services)
    } catch {
      toast.error(t.vendorKeysLoadError)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  const revoke = async (account: OwnedAccount) => {
    if (!window.confirm(t.vendorKeysRevokeConfirm)) return
    try {
      const res = await fetch(`/api/account/vendor-keys/${account.id}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error(String(res.status))
      toast.success(t.vendorKeysRevoked)
      await load()
    } catch {
      toast.error(t.vendorKeysSaveError)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">{t.vendorKeysTitle}</h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t.vendorKeysSub}
        </p>
      </header>

      {accounts.length === 0 ? (
        <p className="rounded-lg border border-border/60 px-4 py-6 text-sm text-muted-foreground">
          {t.vendorKeysEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="space-y-2 rounded-lg border border-border/60 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm font-medium">{account.serviceName}</span>
                <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                  {account.label}
                </span>
                {account.secret ? (
                  <span className="text-sm">
                    <span className="font-mono">{account.secret.hint}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {tf(t.vendorKeysSince, {
                        date: date(account.secret.createdAt),
                      })}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t.vendorKeysNoSecret}
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setRotatingId((prev) =>
                        prev === account.id ? null : account.id,
                      )
                    }
                  >
                    {t.vendorKeysReplace}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void revoke(account)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {rotatingId === account.id ? (
                <SecretForm
                  specs={
                    services.find((s) => s.id === account.serviceId)
                      ?.secretFields ?? [{ key: "apiKey", label: "", secret: true }]
                  }
                  submitLabel={t.vendorKeysReplace}
                  onSubmit={async (fields) => {
                    try {
                      const res = await fetch(
                        `/api/account/vendor-keys/${account.id}/secret`,
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ fields }),
                        },
                      )
                      if (!res.ok) throw new Error(String(res.status))
                      toast.success(t.vendorKeysReplaced)
                      setRotatingId(null)
                      await load()
                    } catch {
                      toast.error(t.vendorKeysSaveError)
                    }
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {services.length === 0 ? (
        <p className="text-xs text-muted-foreground/80">{t.vendorKeysNoServices}</p>
      ) : adding ? (
        <AddForm
          services={services}
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false)
            await load()
          }}
        />
      ) : (
        <Button type="button" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t.vendorKeysAdd}
        </Button>
      )}
    </div>
  )
}

/**
 * Поля секрета по описанию сервиса: `apiKey` либо `login` + `password`.
 * Рисуется по данным, а не по коду — новый вендор не требует правки экрана.
 */
function SecretForm({
  specs,
  submitLabel,
  onSubmit,
}: {
  specs: { key: string; label: string; secret: boolean }[]
  submitLabel: string
  onSubmit: (fields: Record<string, string>) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const filled = specs.every((spec) => (values[spec.key] ?? "").trim().length > 0)

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg bg-muted/30 px-3 py-3">
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
            type={spec.secret ? "password" : "text"}
            autoComplete="off"
            className="max-w-xs"
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        disabled={!filled || busy}
        onClick={async () => {
          setBusy(true)
          try {
            await onSubmit(values)
          } finally {
            setBusy(false)
          }
        }}
      >
        {submitLabel}
      </Button>
    </div>
  )
}

/** Подключить ключ к сервису: выбор сервиса, метка и поля секрета. */
function AddForm({
  services,
  onCancel,
  onDone,
}: {
  services: ServiceOption[]
  onCancel: () => void
  onDone: () => Promise<void>
}) {
  const { t } = useI18n()
  const [serviceId, setServiceId] = useState(services[0]!.id)
  const [label, setLabel] = useState("main")

  const service = services.find((s) => s.id === serviceId) ?? services[0]!

  return (
    <div className="space-y-3 rounded-lg border border-border/60 px-4 py-4">
      <div className="flex flex-wrap gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-normal text-muted-foreground">
            {t.vendorKeysService}
          </Label>
          <Select value={serviceId} onValueChange={setServiceId}>
            <SelectTrigger className="w-[14rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {services.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs font-normal text-muted-foreground">
            {t.vendorKeysLabel}
          </Label>
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            autoComplete="off"
            className="max-w-[12rem]"
          />
          <p className="text-xs text-muted-foreground/80">{t.vendorKeysLabelHint}</p>
        </div>
      </div>

      <SecretForm
        specs={service.secretFields}
        submitLabel={t.vendorKeysConnect}
        onSubmit={async (fields) => {
          if (!label.trim()) return
          try {
            const res = await fetch("/api/account/vendor-keys", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serviceId, label: label.trim(), fields }),
            })
            if (res.status === 409) {
              toast.error(t.vendorKeysLabelTaken)
              return
            }
            if (!res.ok) throw new Error(String(res.status))
            toast.success(t.vendorKeysConnected)
            await onDone()
          } catch {
            toast.error(t.vendorKeysSaveError)
          }
        }}
      />

      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        {t.cancel}
      </Button>
    </div>
  )
}
