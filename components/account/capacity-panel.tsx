"use client"

import { Clock3, Files, HardDrive, Play } from "lucide-react"
import {
  capacityValue,
  type Capacity,
} from "@/components/account/balance-widget"
import { useI18n, type DictKey } from "@/components/account/i18n"
import { cn } from "@/lib/utils"

/**
 * «На что ещё хватит» — остаток, разложенный по мерам.
 *
 * В боковой панели помещаются две меры, и это правильно: там на баланс смотрят
 * мельком. Сюда приходят с вопросом «а сколько это в работе», поэтому здесь
 * показываются все меры сразу — и секунды, и файлы, и объём, и просто запуски.
 *
 * ⚠️ Плитки — ВАРИАНТЫ, а не слагаемые. Это одна и та же сумма, измеренная
 * разными линейками, и подпись обязана сказать это словами: сетка плиток сама
 * по себе читается как «и то, и другое», и человек решит, что ему доступно всё
 * сразу.
 */

const TILES: Record<
  Capacity["meter"],
  { labelKey: DictKey; icon: typeof Clock3 }
> = {
  sec: { labelKey: "capacityTileSec", icon: Clock3 },
  count: { labelKey: "capacityTileCount", icon: Files },
  bytes: { labelKey: "capacityTileBytes", icon: HardDrive },
  runs: { labelKey: "capacityTileRuns", icon: Play },
}

export function CapacityPanel({
  capacity,
  className,
}: {
  /** `null` — ещё не загрузилось: это не то же самое, что «считать не из чего». */
  capacity: Capacity[] | null
  className?: string
}) {
  const { t } = useI18n()

  return (
    <section
      className={cn(
        "rounded-2xl border border-border/60 bg-card px-5 py-5",
        className,
      )}
    >
      <h2 className="text-base font-semibold">{t.capacityTitle}</h2>
      <p className="mt-1 max-w-3xl text-xs text-muted-foreground/80">
        {t.capacitySub}
      </p>

      {capacity == null ? (
        <div className="mt-4 h-[86px] animate-pulse rounded-xl bg-muted/40" />
      ) : capacity.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground/80">
          {t.capacityEmpty}
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {capacity.map((item, index) => {
            const tile = TILES[item.meter]
            const Icon = tile.icon
            return (
              <div
                key={item.meter}
                className="relative rounded-xl border border-border/50 bg-background/40 px-4 py-3.5"
              >
                {/* «или» между плитками, а не запятая: см. предупреждение выше.
                    На узком экране плитки переносятся, поэтому метка висит на
                    самой плитке, а не в промежутке — перенос её не оторвёт. */}
                {index > 0 ? (
                  <span className="absolute -left-[7px] top-1/2 hidden -translate-y-1/2 rounded bg-card px-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 xl:inline">
                    {t.capacityOr}
                  </span>
                ) : null}
                <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[1.1px] text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                  {t[tile.labelKey]}
                </div>
                <div className="mt-2 text-[22px] font-bold tracking-tight">
                  ≈ {capacityValue(item)}
                </div>
                {/* Откуда цифра: по собственным списаниям она близка к правде,
                    по ставке — только прикидка, и молчать об этом нельзя. */}
                <div className="mt-0.5 text-[11px] text-muted-foreground/80">
                  {item.basis === "history"
                    ? t.capacityBasisHistory
                    : t.capacityBasisRate}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
