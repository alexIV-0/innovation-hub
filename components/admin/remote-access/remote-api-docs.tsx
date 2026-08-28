"use client"

import { useMemo, useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  MACHINE_API_ACTIONS,
  MACHINE_API_ERRORS,
  MACHINE_API_PATH,
  type ActionDoc,
  type ActionGroup,
  type LocaleText,
} from "@/lib/machine-api/catalog"
import { cn } from "@/lib/utils"

function loc(text: LocaleText, lang: "ru" | "en") {
  return text[lang]
}

function CodeBlock({
  value,
  copyLabel,
  copiedLabel,
  copyErrorLabel,
}: {
  value: string
  copyLabel: string
  copiedLabel: string
  copyErrorLabel: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(copiedLabel)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(copyErrorLabel)
    }
  }

  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 pr-12 text-[12px] leading-relaxed text-foreground">
        <code>{value}</code>
      </pre>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute right-1.5 top-1.5 h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={() => void handleCopy()}
        title={copyLabel}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </Button>
    </div>
  )
}

function ActionCard({
  doc,
  lang,
  t,
}: {
  doc: ActionDoc
  lang: "ru" | "en"
  t: ReturnType<typeof useAdminI18n>
}) {
  const requestJson = JSON.stringify(
    {
      action: doc.action,
      props: doc.exampleProps,
      token: "rc_…",
    },
    null,
    2,
  )
  const responseJson = JSON.stringify(doc.exampleResponse, null, 2)

  return (
    <AccordionItem
      value={doc.action}
      className="rounded-xl border border-border border-b-0 bg-card px-4"
    >
      <AccordionTrigger className="py-4 hover:no-underline">
        <div className="flex min-w-0 flex-1 items-center gap-3 pr-3 text-left">
          <code className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
            {doc.action}
          </code>
          <span className="truncate text-sm text-muted-foreground">
            {loc(doc.summary, lang)}
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4 pb-4">
        <p className="text-sm text-muted-foreground">{loc(doc.description, lang)}</p>

        {doc.props.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t.remoteApiProp}</th>
                  <th className="py-2 pr-3 font-medium">{t.type}</th>
                  <th className="py-2 pr-3 font-medium">{t.remoteApiRequired}</th>
                  <th className="py-2 font-medium">{t.description}</th>
                </tr>
              </thead>
              <tbody>
                {doc.props.map((prop) => (
                  <tr key={prop.name} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 align-top">
                      <code className="font-mono text-xs">{prop.name}</code>
                    </td>
                    <td className="py-2 pr-3 align-top font-mono text-xs text-muted-foreground">
                      {prop.type}
                    </td>
                    <td className="py-2 pr-3 align-top text-xs">
                      {prop.required ? t.remoteApiRequiredYes : t.optional}
                    </td>
                    <td className="py-2 align-top text-xs text-muted-foreground">
                      {loc(prop.notes, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t.remoteApiNoProps}</p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.remoteApiExample}
            </p>
            <CodeBlock
              value={requestJson}
              copyLabel={t.remoteApiCopy}
              copiedLabel={t.remoteApiCopied}
              copyErrorLabel={t.remoteApiCopyError}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.remoteApiResponse}
            </p>
            <CodeBlock
              value={responseJson}
              copyLabel={t.remoteApiCopy}
              copiedLabel={t.remoteApiCopied}
              copyErrorLabel={t.remoteApiCopyError}
            />
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

export function RemoteApiDocs() {
  const { lang, t: accountT } = useI18n()
  const t = useAdminI18n()
  const [group, setGroup] = useState<"all" | ActionGroup>("all")

  const envelope = useMemo(
    () =>
      JSON.stringify(
        {
          action: "heartbeat",
          props: { status: "idle" },
          token: "rc_…",
        },
        null,
        2,
      ),
    [],
  )

  const curl = `curl -X POST https://<host>${MACHINE_API_PATH} \\
  -H "Content-Type: application/json" \\
  -d '{"action":"me","props":{},"token":"rc_…"}'`

  const actions = MACHINE_API_ACTIONS.filter(
    (doc) => group === "all" || doc.group === group,
  )

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            POST {MACHINE_API_PATH}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {t.remoteApiSingleEndpoint}
          </span>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {accountT.adminRemoteApiIntro}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { step: "1", label: t.remoteApiStepAuth },
            { step: "2", label: t.remoteApiStepProps },
            { step: "3", label: t.remoteApiStepRun },
          ].map((item) => (
            <div
              key={item.step}
              className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2.5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                {t.remoteApiStep} {item.step}
              </p>
              <p className="mt-1 text-sm text-foreground">{item.label}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t.remoteApiEnvelope}
            </p>
            <CodeBlock
              value={envelope}
              copyLabel={t.remoteApiCopy}
              copiedLabel={t.remoteApiCopied}
              copyErrorLabel={t.remoteApiCopyError}
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              curl
            </p>
            <CodeBlock
              value={curl}
              copyLabel={t.remoteApiCopy}
              copiedLabel={t.remoteApiCopied}
              copyErrorLabel={t.remoteApiCopyError}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t.remoteApiErrors}
        </h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2 font-medium">HTTP</th>
                <th className="px-4 py-2 font-medium">{t.description}</th>
              </tr>
            </thead>
            <tbody>
              {MACHINE_API_ERRORS.map((row) => (
                <tr key={row.status} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{row.status}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {loc(row.meaning, lang)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t.actions}
          </h2>
          <div className="flex gap-1 rounded-full border border-border bg-muted/40 p-1">
            {(
              [
                ["all", t.all],
                ["computer", t.remoteApiGroupComputer],
                ["storage", t.remoteApiGroupStorage],
                ["settings", t.remoteApiGroupSettings],
                ["queue", t.remoteApiGroupQueue],
                ["vault", t.remoteApiGroupVault],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setGroup(id)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  group === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Accordion type="multiple" className="space-y-2">
          {actions.map((doc) => (
            <ActionCard key={doc.action} doc={doc} lang={lang} t={t} />
          ))}
        </Accordion>
      </section>
    </div>
  )
}
