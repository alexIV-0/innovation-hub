"use client"

import { CheckCircle2, Clock3 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Две колонки: что раздел статистики уже считает из базы и что ждёт приёмник
 * архива обработок (docs/STATISTICS_PLAN.md). Используется и в кабинете, и в
 * админке — тексты приходят снаружи.
 */
export function StatsReadiness({
  readyTitle,
  ready,
  pendingTitle,
  pending,
}: {
  readyTitle: string
  ready: string[]
  pendingTitle: string
  pending: string[]
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Column title={readyTitle} items={ready} tone="ready" />
      <Column title={pendingTitle} items={pending} tone="pending" />
    </div>
  )
}

function Column({
  title,
  items,
  tone,
}: {
  title: string
  items: string[]
  tone: "ready" | "pending"
}) {
  const Icon = tone === "ready" ? CheckCircle2 : Clock3
  return (
    <div className="rounded-[14px] border border-border/60 bg-ws-control p-4">
      <div className="text-[10.5px] font-semibold tracking-[1.2px] text-ws-4">
        {title}
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-[13px]">
            <Icon
              className={cn(
                "mt-[2px] h-4 w-4 shrink-0",
                tone === "ready" ? "text-success" : "text-ws-4",
              )}
            />
            <span className={tone === "ready" ? "text-ws-2" : "text-ws-4"}>
              {item}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
