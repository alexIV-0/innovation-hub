"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { History, Loader2 } from "lucide-react"

import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { ACTION_META } from "@/components/admin/audit/action-meta"
import { detailsOf } from "@/components/admin/audit/event-details"
import { isAuditAction } from "@/lib/audit-actions"
import { cn } from "@/lib/utils"

/** Больше пяти в подсказке не читают: за подробностями — ссылка в журнал. */
const LIMIT = 5

const PANEL_WIDTH = 320
/** Зазор до значка и до края экрана. */
const GAP = 6
const EDGE = 8
/** Ниже этого подсказку под значком уже не развернуть — уходим вверх. */
const MIN_BELOW = 180
/** Пауза на перевод курсора со значка на подсказку: иначе она гаснет в зазоре. */
const CLOSE_DELAY = 120

type Event = {
  id: string
  actorEmail: string
  action: string
  meta: Record<string, unknown> | null
  createdAt: string
}

type Placement = {
  left: number
  top: number | null
  bottom: number | null
  maxHeight: number
}

/**
 * Координаты подсказки в окне, а не в строке: она живёт в портале.
 *
 * Разворачиваем вниз, но у нижних строк списка места нет — тогда вверх. По
 * горизонтали прижимаем к правому краю значка и не даём выйти за экран: колонка
 * «Конвейера» уже подсказки, и без зажима её половина оказалась бы за бортом.
 */
function measure(anchor: HTMLElement): Placement {
  const rect = anchor.getBoundingClientRect()
  const maxLeft = Math.max(EDGE, window.innerWidth - PANEL_WIDTH - EDGE)
  const left = Math.min(Math.max(EDGE, rect.right - PANEL_WIDTH), maxLeft)
  const below = window.innerHeight - rect.bottom - GAP - EDGE
  const above = rect.top - GAP - EDGE
  return below < MIN_BELOW && above > below
    ? {
        left,
        top: null,
        bottom: window.innerHeight - rect.top + GAP,
        maxHeight: above,
      }
    : { left, top: rect.bottom + GAP, bottom: null, maxHeight: below }
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
 *
 * Сама подсказка рисуется в портале у <body>, а не рядом со значком, и это не
 * вкусовщина. Строка заблокированного пользователя приглушена `opacity`, а
 * прозрачность наследуется потомками и заводит свой слой: подсказка внутри
 * строки выцветала до нечитаемости и уезжала под соседние карточки, потому что
 * `z-index` внутри такого слоя наружу не действует. Плюс колонка со списком
 * прокручивается, а прокрутка обрезает всё, что вылезает за её границы.
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
  const [placement, setPlacement] = useState<Placement | null>(null)
  const [events, setEvents] = useState<Event[] | null>(null)
  const [loading, setLoading] = useState(false)
  const loaded = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const linkRef = useRef<HTMLAnchorElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const show = useCallback(() => {
    cancelClose()
    if (buttonRef.current) setPlacement(measure(buttonRef.current))
    setOpen(true)
  }, [cancelClose])

  const hideNow = useCallback(() => {
    cancelClose()
    setOpen(false)
  }, [cancelClose])

  const hideSoon = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY)
  }, [cancelClose])

  useEffect(() => cancelClose, [cancelClose])

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
   * Пока подсказка открыта, значок под ней ездит: список прокручивают, окно
   * меняют. Пересчитываем на оба события, а по Escape закрываем — открытую
   * наведением подсказку клавиатурой иначе не убрать.
   */
  useEffect(() => {
    if (!open) return
    const reposition = () => {
      if (buttonRef.current) setPlacement(measure(buttonRef.current))
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideNow()
    }
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open, hideNow])

  /**
   * Без права смотреть журнал значка нет вовсе, а не пустая подсказка: пустота
   * читается как «ничего не происходило», и это была бы ложь.
   */
  if (!can("audit.view")) return null

  const locale = lang === "ru" ? "ru-RU" : "en-US"

  const panel =
    open && placement && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            data-no-edit
            role="tooltip"
            style={{
              left: placement.left,
              top: placement.top ?? undefined,
              bottom: placement.bottom ?? undefined,
              width: PANEL_WIDTH,
              maxHeight: Math.max(MIN_BELOW, placement.maxHeight),
            }}
            onMouseEnter={cancelClose}
            onMouseLeave={hideSoon}
            // Портал уводит подсказку из строки в DOM, но не в дереве React:
            // клик по ссылке иначе всплыл бы в строку и открыл карточку
            // пользователя вместо перехода в журнал.
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            className="fixed z-[100] overflow-y-auto rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-xl"
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
                {events.map((event) => {
                  const action = event.action
                  // «Изменена роль» без «из чего во что» — уведомление, а не
                  // ответ: как раз за «во что» в журнал и заглядывают. Формат
                  // общий с лентой /admin/audit, чтобы одно событие в двух
                  // местах читалось одинаково.
                  const details = isAuditAction(action)
                    ? detailsOf({ action, meta: event.meta }, t)
                    : null
                  return (
                    <span key={event.id} className="block text-[12.5px] leading-snug">
                      <span className="text-foreground">
                        {isAuditAction(action)
                          ? (t[ACTION_META[action].labelKey] as string)
                          : action}
                      </span>
                      {details ? (
                        <span className="ml-1.5 rounded bg-muted/60 px-1 py-px font-mono text-[11px] text-muted-foreground">
                          {details}
                        </span>
                      ) : null}
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
                  )
                })}
              </span>
            )}

            <Link
              ref={linkRef}
              href={`/admin/audit?targetType=user&targetId=${encodeURIComponent(
                userId,
              )}&targetLabel=${encodeURIComponent(userLabel)}`}
              // Обратный ход к значку: портал стоит в конце <body>, и Shift+Tab
              // увёл бы фокус в конец страницы, а не туда, откуда пришли.
              onKeyDown={(event) => {
                if (event.key === "Tab" && event.shiftKey) {
                  event.preventDefault()
                  buttonRef.current?.focus()
                }
              }}
              onBlur={(event) => {
                if (
                  !panelRef.current?.contains(event.relatedTarget) &&
                  event.relatedTarget !== buttonRef.current
                ) {
                  hideNow()
                }
              }}
              className="mt-2 block text-[12.5px] text-primary hover:underline"
            >
              {t.userHistoryOpenAll}
            </Link>
          </div>,
          document.body,
        )
      : null

  return (
    <span
      data-no-edit
      className={cn("relative inline-flex", className)}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-label={t.userHistoryTitle}
        aria-expanded={open}
        onFocus={show}
        onBlur={(event) => {
          if (!panelRef.current?.contains(event.relatedTarget)) hideNow()
        }}
        onClick={(event) => {
          event.stopPropagation()
          if (open) hideNow()
          else show()
        }}
        // Ссылка «весь журнал» лежит в портале в конце <body>, поэтому обычный
        // Tab до неё не доходит: уводим фокус туда руками, иначе с клавиатуры
        // подсказку можно только прочитать.
        onKeyDown={(event) => {
          if (open && event.key === "Tab" && !event.shiftKey && linkRef.current) {
            event.preventDefault()
            linkRef.current.focus()
          }
        }}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <History className="h-3.5 w-3.5" />
      </button>

      {panel}
    </span>
  )
}
