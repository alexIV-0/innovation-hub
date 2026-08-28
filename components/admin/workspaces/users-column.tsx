"use client"

import { useMemo, useState } from "react"
import { Loader2, Search, UserX } from "lucide-react"
import { toast } from "sonner"

import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { UserHistory } from "@/components/admin/shared/user-history"
import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { cn } from "@/lib/utils"

export type PipelineUserDto = {
  id: string
  fullName: string
  email: string
  automationEnabled: boolean
  isActive: boolean
  projectCount: number
  watchedCount: number
  archivedCount: number
  lastActivityAt: string | null
}

type Props = {
  users: PipelineUserDto[]
  loading: boolean
  selectedUserId: string | null
  onSelectUser: (userId: string) => void
  onToggle: (userId: string, enabled: boolean) => void
}

/**
 * Колонка 1 «Конвейера»: кто участвует в обработке.
 *
 * Тумблер здесь — гейт уровня пользователя: он снимает со слежения все проекты
 * сразу, но не меняет их собственные флаги. Поэтому рядом с ним показываем, из
 * чего состоит его список: сколько проектов под слежением и сколько в архиве —
 * иначе непонятно, почему у включённого пользователя ничего не обрабатывается.
 */
export function UsersColumn({
  users,
  loading,
  selectedUserId,
  onSelectUser,
  onToggle,
}: Props) {
  const t = useAdminI18n()
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string | null>(null)

  const { size, dragging, onPointerDown, onKeyDown } = useDragSize({
    initial: 300,
    min: 240,
    max: 480,
    axis: "x",
    storageKey: "ffworks-pipeline-users-width",
  })

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q),
    )
  }, [users, query])

  const enabledCount = users.filter((u) => u.automationEnabled).length

  const toggle = async (user: PipelineUserDto) => {
    setPending(user.id)
    try {
      const res = await fetch("/api/admin/workspaces/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          automationEnabled: !user.automationEnabled,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.message ?? t.pipelineUserToggleError)
        return
      }
      onToggle(user.id, !user.automationEnabled)
    } catch {
      toast.error(t.pipelineServerUnavailable)
    } finally {
      setPending(null)
    }
  }

  return (
    <section
      style={{ width: size }}
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-r border-white/[0.08] bg-ws-well"
    >
      <div className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-0.5 w-4 shrink-0 rounded bg-ws-accent" />
            <span className="truncate text-[14px] font-semibold uppercase tracking-[1.6px] text-ws-accent">
              {t.pipelineUsers}
            </span>
          </div>
          <span className="shrink-0 text-[12px] text-ws-4">
            {enabledCount}/{users.length}
          </span>
        </div>

        <div className="relative mt-3">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ws-4"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.pipelineUserSearch}
            className="h-[38px] w-full rounded-[9px] border border-white/10 bg-ws-control pl-[34px] pr-3 text-[13px] text-ws-1 outline-none placeholder:text-ws-4 focus:border-ws-select"
          />
        </div>
      </div>

      <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-3 pb-2.5">
        {loading ? (
          <div className="flex justify-center py-10 text-ws-4">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-ws-4">
            {t.pipelineNothingFound}
          </p>
        ) : (
          <ul className="pt-1">
            {visible.map((user) => {
              const active = user.id === selectedUserId
              const busy = pending === user.id
              return (
                <li key={user.id}>
                  <div
                    className={cn(
                      "mb-1 flex items-start gap-2.5 rounded-[10px] px-2.5 py-2.5",
                      active ? "bg-ws-hover" : "hover:bg-white/[0.04]",
                      // Заблокированный аккаунт и снятый гейт приглушаем: строка
                      // остаётся читаемой, но видно, что обработки по ней нет.
                      !user.isActive || !user.automationEnabled
                        ? "opacity-55"
                        : null,
                    )}
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={user.automationEnabled}
                      aria-label={tf(t.pipelineWatchAria, { email: user.email })}
                      disabled={busy || !user.isActive}
                      onClick={() => void toggle(user)}
                      className={cn(
                        "relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-40",
                        user.automationEnabled ? "bg-ws-action" : "bg-white/10",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-[3px] h-[14px] w-[14px] rounded-full bg-white transition-all",
                          user.automationEnabled ? "left-[19px]" : "left-[3px]",
                        )}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => onSelectUser(user.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "truncate text-[13.5px]",
                            active ? "text-ws-1" : "text-ws-2",
                          )}
                        >
                          {user.fullName || user.email}
                        </span>
                        {user.isActive ? null : (
                          <UserX
                            className="h-3.5 w-3.5 shrink-0 text-ws-5"
                            aria-label={t.pipelineSuspendedAria}
                          />
                        )}
                      </span>
                      {user.fullName ? (
                        <span className="mt-0.5 block truncate text-[11.5px] text-ws-4">
                          {user.email}
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-ws-4">
                        <span>
                          {tf(t.pipelineWatchedOf, {
                            watched: user.watchedCount,
                            total: user.projectCount,
                          })}
                        </span>
                        {user.archivedCount > 0 ? (
                          <span className="text-ws-5">
                            {tf(t.pipelineArchived, {
                              count: user.archivedCount,
                            })}
                          </span>
                        ) : null}
                      </span>
                    </button>

                    {/* Вне кнопки выбора намеренно: кнопка внутри кнопки
                        невалидна, и клик по значку выбирал бы пользователя
                        вместо того, чтобы показать, что с ним делали. */}
                    <UserHistory
                      userId={user.id}
                      userLabel={user.email}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <ResizeGrip
        orientation="vertical"
        side="right"
        label={t.pipelineUsers}
        dragging={dragging}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
      />
    </section>
  )
}
