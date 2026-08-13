"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, ListOrdered, Loader2, Play, Square } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import type { PipelineState } from "@/lib/pipeline/state"
import type { TaskCounts } from "@/lib/pipeline/tasks"
import { TasksDialog } from "./tasks-dialog"

/** Пока слежение включено, состояние подтягиваем чаще — видно, что цикл живой. */
const POLL_RUNNING_MS = 10_000
const POLL_IDLE_MS = 30_000

function fmtTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * Нижняя полоса страницы «Конвейер»: одна кнопка на всю ширину.
 *
 * Выбирать пользователя или проект для запуска не нужно. Слежение идёт сразу по
 * всем включённым пользователям и всем их проектам, которые не на паузе и не в
 * архиве — то есть кнопка управляет одним состоянием на всю установку, а не тем,
 * что выбрано в колонках выше.
 *
 * Запуск — начать следить за папками IN и собирать объекты для обработки.
 * Стоп — прекратить и слежение, и сборку. Уже созданные задачи остаются в очереди.
 */
export function PipelineRunBar() {
  const [state, setState] = useState<PipelineState | null>(null)
  const [counts, setCounts] = useState<TaskCounts | null>(null)
  const [busy, setBusy] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  /**
   * Ошибка опроса состояния. Показывается в строке статуса, а не тостом: опрос
   * идёт по таймеру, и тост на каждом круге был бы невыносим. Но и молчать
   * нельзя — иначе недоступный эндпоинт выглядит как беспричинно мёртвая полоса.
   */
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/pipeline/state")
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setLoadError(data?.message ?? `Состояние недоступно (${res.status})`)
        return
      }
      const data = await res.json()
      setState(data.state ?? null)
      setCounts(data.counts ?? null)
      setLoadError(null)
    } catch {
      setLoadError("Сервер недоступен")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const running = state?.isRunning === true

  useEffect(() => {
    const interval = setInterval(
      () => void load(),
      running ? POLL_RUNNING_MS : POLL_IDLE_MS,
    )
    return () => clearInterval(interval)
  }, [load, running])

  const toggle = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/admin/pipeline/state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ running: !running }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.message ?? "Не удалось изменить состояние конвейера.")
        return
      }
      setState(data.state ?? null)
      setCounts(data.counts ?? null)
      toast.success(
        data.state?.isRunning
          ? "Слежение включено — задачи будут появляться сами."
          : "Слежение остановлено.",
      )
    } catch {
      toast.error("Сервер недоступен.")
    } finally {
      setBusy(false)
    }
  }

  const inFlight = counts ? counts.claimed + counts.running : 0

  return (
    <>
      <div className="shrink-0 border-t border-white/[0.08] bg-ws-well px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ws-4">
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-[7px] w-[7px] rounded-full",
                running ? "bg-ws-out" : "bg-ws-5",
              )}
            />
            {running ? "следим за папками IN" : "слежение остановлено"}
          </span>
          {running && state?.startedByEmail ? (
            <span>включил {state.startedByEmail}</span>
          ) : null}
          {state?.scannedAt ? (
            <span>последняя проверка {fmtTime(state.scannedAt)}</span>
          ) : null}
          {counts ? (
            <span>
              в очереди {counts.queued} · в работе {inFlight} · готово{" "}
              {counts.done}
              {counts.failed > 0 ? ` · ошибок ${counts.failed}` : ""}
            </span>
          ) : null}
          {state?.lastError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {state.lastError}
            </span>
          ) : null}
          {loadError ? (
            <span className="flex items-center gap-1.5 text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {loadError}
            </span>
          ) : null}
        </div>

        <div className="flex items-stretch gap-3">
          <button
            type="button"
            onClick={() => void toggle()}
            // Гасим только на время самого запроса. Раньше кнопка блокировалась
            // и при state === null, то есть при недоступном эндпоинте состояния —
            // запустить конвейер становилось нечем, и почему, было не видно.
            disabled={busy}
            className={cn(
              "flex h-[52px] flex-1 items-center justify-center gap-3 rounded-[11px] text-[16px] font-semibold text-white",
              "disabled:opacity-60",
              running
                ? "bg-destructive hover:brightness-110"
                : "bg-ws-action hover:bg-ws-action-hover",
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : running ? (
              <Square className="h-[18px] w-[18px]" />
            ) : (
              <Play className="h-5 w-5" />
            )}
            {running ? "Остановить слежение" : "Запустить слежение"}
          </button>

          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="flex h-[52px] shrink-0 items-center gap-2.5 rounded-[11px] border border-white/[0.14] px-5 text-[14px] text-ws-2 hover:bg-white/5"
          >
            <ListOrdered className="h-[18px] w-[18px]" />
            Очередь
            {counts && counts.total > 0 ? (
              <span className="rounded-full bg-white/10 px-2 py-[2px] text-[12px] tabular-nums text-ws-1">
                {counts.total}
              </span>
            ) : null}
          </button>
        </div>
      </div>

      {queueOpen ? <TasksDialog onClose={() => setQueueOpen(false)} /> : null}
    </>
  )
}
