import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type Trend = {
  value: number
  label?: string
}

type Props = {
  label: string
  value: number | string
  icon: LucideIcon
  accent?: "primary" | "amber" | "emerald" | "violet"
  hint?: string
  trend?: Trend
  spark?: number[]
}

const accentMap: Record<NonNullable<Props["accent"]>, string> = {
  primary: "from-primary/25 via-primary/10 to-transparent text-primary",
  amber: "from-amber-400/25 via-amber-400/10 to-transparent text-amber-300",
  emerald:
    "from-emerald-400/25 via-emerald-400/10 to-transparent text-emerald-300",
  violet: "from-violet-400/25 via-violet-400/10 to-transparent text-violet-300",
}

function Sparkline({ values, accent }: { values: number[]; accent: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const w = 96
  const h = 32
  const step = w / (values.length - 1)
  const path = values
    .map((v, i) => {
      const x = i * step
      const y = h - ((v - min) / range) * h
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(" ")
  const colorClass =
    accent === "amber"
      ? "stroke-amber-300"
      : accent === "emerald"
        ? "stroke-emerald-300"
        : accent === "violet"
          ? "stroke-violet-300"
          : "stroke-primary"
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-24 text-current"
      fill="none"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d={path}
        className={cn("transition-colors", colorClass)}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accent = "primary",
  hint,
  trend,
  spark,
}: Props) {
  const trendUp = trend ? trend.value >= 0 : false
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/80 p-5 transition-colors hover:border-border">
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 -top-20 h-40 bg-gradient-to-b opacity-60 blur-2xl transition-opacity group-hover:opacity-90",
          accentMap[accent],
        )}
        aria-hidden
      />
      <div className="relative flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/40 backdrop-blur",
            accent === "primary" && "text-primary",
            accent === "amber" && "text-amber-300",
            accent === "emerald" && "text-emerald-300",
            accent === "violet" && "text-violet-300",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div className="relative mt-5 flex items-end justify-between gap-3">
        <div>
          <p className="font-display text-3xl font-semibold tracking-tight text-foreground tabular-nums md:text-[34px]">
            {value}
          </p>
          {hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        {spark && spark.length >= 2 ? (
          <Sparkline values={spark} accent={accent} />
        ) : null}
      </div>

      {trend ? (
        <div className="relative mt-4 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold",
              trendUp
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-rose-500/15 text-rose-300",
            )}
          >
            {trendUp ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {trendUp ? "+" : ""}
            {trend.value}%
          </span>
          {trend.label ? (
            <span className="text-muted-foreground">{trend.label}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
