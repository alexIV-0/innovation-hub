"use client"

import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { cn } from "@/lib/utils"
import type { SaveState } from "./use-autosave"

/**
 * Состояние автосохранения в топбаре.
 *
 * Общий для инструментов раздела: сохраняются они одинаково, и второй копии
 * этого индикатора существовать незачем.
 *
 * **Ширина у него постоянная.** Состояние меняется на каждой правке, а подписи
 * разной длины двигали бы всё, что стоит справа, — кнопки уезжали из-под курсора
 * по несколько раз за фразу. Место под самую широкую подпись держится всегда:
 * пустое место справа лучше, чем прыгающий топбар.
 *
 * Подписи поэтому короткие, а полная — в подсказке: индикатор нужен для взгляда
 * мимоходом, а разбираться в подробностях идут наведением.
 */
export function SaveBadge({
  state,
  dirty,
  onFlush,
}: {
  state: SaveState
  dirty: boolean
  onFlush: () => void
}) {
  const { t } = useWorkspace()

  const view =
    state.kind === "saving"
      ? { icon: Loader2, text: t.srtSaveSaving, hint: t.srtSaveSaving, tone: "text-ws-3", spin: true }
      : state.kind === "error"
        ? {
            icon: CloudOff,
            text: t.srtSaveErrorShort,
            hint: state.message,
            tone: "text-ws-playhead",
            spin: false,
          }
        : state.kind === "merged"
          ? {
              icon: TriangleAlert,
              text: t.srtSaveMergedShort,
              hint: t.srtSaveMerged,
              tone: "text-[#e0a33a]",
              spin: false,
            }
          : dirty || state.kind === "pending"
            ? {
                icon: TriangleAlert,
                text: t.srtSavePendingShort,
                hint: t.srtSavePending,
                tone: "text-ws-4",
                spin: false,
              }
            : {
                icon: Check,
                text: t.srtSaveClean,
                hint: t.srtSaveClean,
                tone: "text-ws-out",
                spin: false,
              }
  const Icon = view.icon

  /** Все подписи разом держат ширину: считать пиксели на каждый язык — нельзя. */
  const labels = [
    t.srtSaveClean,
    t.srtSaveSaving,
    t.srtSavePendingShort,
    t.srtSaveErrorShort,
    t.srtSaveMergedShort,
  ]

  return (
    <button
      type="button"
      onClick={onFlush}
      disabled={!dirty && state.kind !== "error"}
      title={dirty || state.kind === "error" ? `${view.hint} — ${t.srtSaveNow}` : view.hint}
      className={cn(
        "flex h-[34px] flex-none items-center gap-1.5 rounded px-2 text-[12px]",
        view.tone,
        dirty || state.kind === "error" ? "hover:bg-ws-hover" : "cursor-default",
      )}
    >
      <Icon className={cn("h-4 w-4 flex-none", view.spin && "animate-spin")} />
      {/*
        Сетка в одну клетку: все подписи лежат друг на друге, ширину задаёт самая
        широкая, видна одна. Так слот не зависит ни от состояния, ни от языка.
      */}
      <span className="hidden lg:grid">
        {labels.map((label) => (
          <span key={label} aria-hidden className="invisible col-start-1 row-start-1 whitespace-nowrap">
            {label}
          </span>
        ))}
        <span className="col-start-1 row-start-1 whitespace-nowrap text-left">{view.text}</span>
      </span>
    </button>
  )
}
