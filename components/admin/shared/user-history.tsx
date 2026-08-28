"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { History, Loader2 } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { ACTION_META } from "@/components/admin/audit/action-meta"
import { isAuditAction } from "@/lib/audit-actions"
import { cn } from "@/lib/utils"

/** Больше пяти в подсказке не читают: за подробностями — ссылка в журнал. */
const LIMIT = 5

type Event = {
  id: string
  actorEmail: string
  action: string
  createdAt: string
}

/**
 * «Что делали с этим аккаунтом»: последние записи журнала по человеку.
 *
 * Зачем: правило «админ не трогает равного и старшего» существует и работает, а
 * вот объяснить себя оно не умеет. Погашенный пункт меню не отличает «нет тега»
 * от «это админ, нужен суперадмин» и не говорит, кто и когда заблокировал, —
 * отсюда и берётся ощущение, что тебе кто-то запретил. Разбор —
 * docs/ADMIN_WORKSPACE_PLAN.md §8.
 *
 * Открывается наведением И фокусом: подсказка, доступная только мышью, для
 * клавиатуры не существует. Запрос уходит при первом открытии, а не при
 * отрисовке строки: иначе список из полусотни людей превратился бы в полусотню
 * запросов, из которых прочитают один.
 */
export function UserHistory({
  userId,
  userLabel,
  className,
}: {
  userId: string
  userLabel: string
  className?: string
}) {
  const t = useAdminI18n()
  const { lang } = useI18n()
  const { can } = useAdminData()
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<Event[] | null>(null)
  const [loading, setLoading] = useState(false)
  const loaded = useRef(false)

  const load = useCallback(async () => {
    if (loaded.current) return
    loaded.current = true
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: String(LIMIT),
        targetType: "user",
        targetId: userId,
      })
      const res = await fetch(`/api/admin/audit?${params}`, {
        cache: "no-store",
      })
      if (!res.ok) {
        // Повторим при следующем открытии: одна неудачная попытка не повод
        // показывать пустоту навсегда — она читается как «ничего не было».
        loaded.current = false
        return
      }
      const data = await res.json()
      setEvents(data.events ?? [])
    } catch {
      loaded.current = false
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  /**
   * Без права смотреть журнал значка нет вовсе, а не пустая подсказка: пустота
   * читается как «ничего не происходило», и это была бы ложь.
   */
  if (!can("audit.view")) return null

  const locale = lang === "ru" ? "ru-RU" : "en-US"

  return (
    <span
      data-no-edit
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t.userHistoryTitle}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
            setOpen(false)
          }
        }}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((v) => !v)
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <History className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <span
          role="tooltip"
          className="absolute right-0 top-7 z-50 w-[320px] rounded-xl border border-border bg-popover p-3 text-left shadow-lg"
        >
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t.userHistoryTitle}
          </span>

          {loading && !events ? (
            <span className="flex justify-center py-3 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </span>
          ) : !events || events.length === 0 ? (
            <span className="block py-2 text-[13px] text-muted-foreground">
              {t.userHistoryEmpty}
            </span>
          ) : (
            <span className="block space-y-1.5">
              {events.map((event) => (
                <span key={event.id} className="block text-[12.5px] leading-snug">
                  <span className="text-foreground">
                    {isAuditAction(event.action)
                      ? (t[ACTION_META[event.action].labelKey] as string)
                      : event.action}
                  </span>
                  <span className="block text-muted-foreground">
                    {event.actorEmail} ·{" "}
                    {new Date(event.createdAt).toLocaleString(locale, {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </span>
              ))}
            </span>
          )}

          <Link
            href={`/admin/audit?targetType=user&targetId=${encodeURIComponent(
              userId,
            )}&targetLabel=${encodeURIComponent(userLabel)}`}
            className="mt-2 block text-[12.5px] text-primary hover:underline"
          >
            {t.userHistoryOpenAll}
          </Link>
        </span>
      ) : null}
    </span>
  )
}
