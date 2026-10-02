"use client"

import { useMemo } from "react"

import { parseMarkup, type MarkupProps } from "@/lib/tools/element/markup"
import { cn } from "@/lib/utils"

/**
 * Текст с разметкой §8.2 только для чтения: цвет, размер, жирный, курсив,
 * комментарий — подчёркиванием точками и подсказкой при наведении.
 *
 * Рисует так же, как марки редактора (`markup-marks.ts`): размер — в `em`
 * относительно окружающего текста, цвет — инлайном, потому что это значение
 * из файла, а не токен темы. Так файл выглядит одинаково и в просмотре, и в
 * правке.
 *
 * Комментарий — подчёркивание точками и бледная метка с его текстом сразу
 * после фрагмента.
 *
 * Копирование отсюда — только чистым текстом: без него браузер положил бы в
 * буфер и HTML с цветами и размерами, и вставка в почту или документ притащила
 * бы оформление. Комментарии — подсказка, в текст они не попадают и так.
 */
export function MarkupView({
  source,
  className,
}: {
  source: string
  className?: string
}) {
  const parts = useMemo(() => {
    const { text, ranges } = parseMarkup(source)
    const out: { text: string; props?: MarkupProps }[] = []
    let cursor = 0
    for (const range of ranges) {
      if (range.start > cursor) out.push({ text: text.slice(cursor, range.start) })
      out.push({
        text: text.slice(range.start, range.start + range.length),
        props: range.props,
      })
      cursor = range.start + range.length
    }
    if (cursor < text.length) out.push({ text: text.slice(cursor) })
    return out
  }, [source])

  return (
    <div
      onCopy={(event) => {
        const selection = window.getSelection()
        if (!selection || selection.isCollapsed) return
        // Метки комментариев видны, но текстом не являются: из копии их
        // вырезаем, даже если браузер включил их в выделение.
        const holder = document.createElement("div")
        for (let i = 0; i < selection.rangeCount; i++) {
          holder.appendChild(selection.getRangeAt(i).cloneContents())
        }
        holder.querySelectorAll("[data-note-badge]").forEach((el) => el.remove())
        event.preventDefault()
        event.clipboardData.setData("text/plain", holder.textContent ?? "")
      }}
      className={cn(
        "whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ws-1",
        className,
      )}
    >
      {parts.map((part, i) => {
        const props = part.props
        if (!props) return <span key={i}>{part.text}</span>
        const fragment = (
          <span
            key={i}
            title={props.note}
            className={cn(
              props.bold && "font-bold",
              props.italic && "italic",
              props.note && "underline decoration-dotted underline-offset-4",
            )}
            style={{
              color: props.color,
              fontSize: props.scale ? `${props.scale}em` : undefined,
            }}
          >
            {part.text}
          </span>
        )
        if (!props.note) return fragment
        // Комментарий — видимой бледной меткой сразу после фрагмента, а не
        // только подсказкой при наведении: его пишут, чтобы прочитали.
        return (
          <span key={i}>
            {fragment}
            <span
              data-note-badge
              aria-label={props.note}
              className="mx-1 select-none whitespace-normal rounded bg-foreground/[0.06] px-1.5 py-px align-[0.1em] text-[11.5px] font-normal not-italic text-ws-4"
            >
              {props.note}
            </span>
          </span>
        )
      })}
    </div>
  )
}
