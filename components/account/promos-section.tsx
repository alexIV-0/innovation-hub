"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Gift, Sparkles } from "lucide-react"
import { toast } from "sonner"
import {
  formatBalance,
  tf,
  useI18n,
  type DictKey,
} from "@/components/account/i18n"
import { cn } from "@/lib/utils"

/**
 * «Акции» — всё подарочное, что человеку начислили.
 *
 * Живёт на кошельке, а не отдельной страницей: подарок это те же деньги, просто
 * с условиями, и искать их в другом разделе человек не станет — он придёт туда,
 * где смотрит баланс.
 *
 * Показываем и закрытые подарки. Израсходованный подарок — не мусор в списке, а
 * ответ на вопрос «а где те 6 000, мне же дарили»: без строки с пометкой
 * «израсходован» этот вопрос приходит в поддержку.
 */

type Promo = {
  grantId: string
  kind: "trial" | "targeted"
  status: "provisioning" | "active" | "exhausted" | "expired" | "revoked"
  amountCents: number
  spentCents: number
  remainingCents: number
  burnedCents: number
  createdAt: string
  expiresAt: string | null
  comment: string
  /** Привязан ли подарок к проектам. Пустой список при `true` — их удалили. */
  scoped: boolean
  projects: { id: string; name: string }[]
}

type PromosResponse = {
  promos: Promo[]
  /** Ещё не взятый тестовый период. Тоже акция, просто пока предложение. */
  offer: { amountCents: number; lifetimeDays: number | null } | null
}

const STATUS_LABEL: Record<Promo["status"], DictKey> = {
  provisioning: "promosStatusProvisioning",
  active: "promosStatusActive",
  exhausted: "promosStatusExhausted",
  expired: "promosStatusExpired",
  revoked: "promosStatusRevoked",
}

export function PromosSection({ className }: { className?: string }) {
  const { t, lang } = useI18n()
  const [data, setData] = useState<PromosResponse | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account/promos", { cache: "no-store" })
      if (!res.ok) throw new Error(String(res.status))
      setData((await res.json()) as PromosResponse)
    } catch {
      toast.error(t.promosLoadError)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const money = (cents: number) => formatBalance(cents, lang)
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-card px-5 py-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary/80" />
        <h2 className="text-base font-semibold">{t.promosTitle}</h2>
      </div>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground/80">
        {t.promosSub}
      </p>

      {/* Предложение — сверху и заметно: это единственная строка списка, по
          которой можно что-то сделать прямо сейчас. Активируется период на
          дашборде, в диалоге с условиями: подарок берут осознанно. */}
      {data?.offer ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Gift className="h-4 w-4 text-primary/80" />
              {tf(t.promosOffer, { amount: money(data.offer.amountCents) })}
            </div>
            {data.offer.lifetimeDays != null ? (
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                {tf(t.promosOfferLifetime, { days: data.offer.lifetimeDays })}
              </div>
            ) : null}
          </div>
          <Link
            href="/account?trial=1"
            className="shrink-0 rounded-lg bg-primary/25 px-3 py-1.5 text-[13px] text-foreground hover:bg-primary/35"
          >
            {t.promosOfferGo}
          </Link>
        </div>
      ) : null}

      {data == null ? (
        <div className="mt-4 h-[92px] animate-pulse rounded-xl bg-muted/40" />
      ) : data.promos.length === 0 ? (
        data.offer ? null : (
          <p className="mt-4 text-sm text-muted-foreground/80">
            {t.promosEmpty}
          </p>
        )
      ) : (
        <ul className="mt-4 flex flex-col gap-3">
          {data.promos.map((promo) => (
            <li
              key={promo.grantId}
              className={cn(
                "rounded-xl border border-border/50 bg-background/40 px-4 py-3.5",
                // Закрытый подарок гасим целиком, а не прячем: он остаётся
                // ответом на «а где те деньги», но не спорит за внимание с
                // действующим.
                promo.status !== "active" &&
                  promo.status !== "provisioning" &&
                  "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="text-sm font-medium">
                    {promo.kind === "trial"
                      ? t.promoKindTrial
                      : t.promoKindTargeted}
                  </span>
                  <span className="ml-2 rounded bg-muted/60 px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                    {t[STATUS_LABEL[promo.status]]}
                  </span>
                </div>
                {/* Пока проекты копируются, денег на кошельке ещё нет (П7):
                    жирный ноль в этот момент прочитался бы как «подарок пуст».
                    Поэтому у `provisioning` крупно стоит обещанная сумма. */}
                <div className="text-right">
                  <div className="text-[17px] font-bold tracking-tight">
                    {money(
                      promo.status === "provisioning"
                        ? promo.amountCents
                        : promo.remainingCents,
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {promo.status === "provisioning"
                      ? t.promosPending
                      : t.promosLeft}
                  </div>
                </div>
              </div>

              {/* Комментарий администратора — за что подарок. Он и объясняет
                  человеку строку, которую иначе пришлось бы угадывать. */}
              {promo.comment ? (
                <p className="mt-1.5 text-[13px] text-muted-foreground">
                  {promo.comment}
                </p>
              ) : null}

              {promo.amountCents > 0 ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{
                      width: `${Math.min(100, Math.round((promo.spentCents / promo.amountCents) * 100))}%`,
                    }}
                  />
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                {promo.status === "provisioning" ? null : (
                  <>
                    <span>
                      {t.promosAmount}: {money(promo.amountCents)}
                    </span>
                    <span>
                      {t.promosSpent}: {money(promo.spentCents)}
                    </span>
                  </>
                )}
                {promo.burnedCents > 0 ? (
                  <span>
                    {t.promosBurned}: {money(promo.burnedCents)}
                  </span>
                ) : null}
                <span>
                  {promo.expiresAt
                    ? tf(t.promosUntil, { date: date(promo.expiresAt) })
                    : t.promosNoExpiry}
                </span>
              </div>

              {/* Где действует. Пустой список — в любом проекте владельца, и это
                  надо сказать словами: пустота на месте списка читается как
                  «нигде». */}
              <div className="mt-1 text-[11.5px] text-muted-foreground/80">
                {promo.projects.length === 0 ? (
                  // Список пуст по двум разным причинам, и путать их нельзя:
                  // подарок без привязки работает везде, подарок с удалёнными
                  // проектами — уже нигде.
                  promo.scoped ? (
                    t.promosProjectsGone
                  ) : (
                    t.promosEverywhere
                  )
                ) : (
                  <>
                    {t.promosWhere}{" "}
                    {promo.projects.map((project, index) => (
                      <span key={project.id}>
                        {index > 0 ? ", " : ""}
                        <Link
                          href={`/account/projects/${project.id}`}
                          className="hover:text-foreground hover:underline"
                        >
                          {project.name}
                        </Link>
                      </span>
                    ))}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
