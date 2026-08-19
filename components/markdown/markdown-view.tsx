"use client"

import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import rehypeSanitize from "rehype-sanitize"
import type { Element } from "hast"

import { descriptionSanitizeSchema } from "@/lib/markdown/description-format"
import { cn } from "@/lib/utils"
import { MermaidBlock } from "./mermaid-block"

/**
 * Единый просмотрщик описания проекта (`options/description.md`).
 *
 * ⚠️ Порядок плагинов критичен: remark-gfm → rehype-raw → rehype-sanitize.
 * Если санитайз встанет раньше rehype-raw, разметка либо не разберётся, либо
 * пролезет непроверенной. Санитайз обязателен именно на рендере, а не только на
 * сохранении: файл приходит из программы и мог быть отредактирован кем угодно —
 * доверенным содержимым он не является ни для одной из сторон (контракт §6).
 *
 * Оформление — классы `.md-body` (типографика) и `.md-palette` (имена цветов из
 * файла → токены) в app/globals.css. Одним и тем же компонентом рисуется и
 * панель описания, и модалка, и превью в редакторе: иначе «как вижу» и «как
 * сохранится» разъезжались бы.
 */

/** Текст и язык фенса из hast-узла `<pre>`: `<pre><code class="language-x">`. */
function fenceInfo(node: Element | undefined): { lang: string; text: string } | null {
  const code = node?.children?.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  )
  if (!code) return null

  const classes = code.properties?.className
  const list = Array.isArray(classes) ? classes.map(String) : []
  const lang = list.find((c) => c.startsWith("language-"))?.slice("language-".length) ?? ""

  const text = code.children
    .map((child) => (child.type === "text" ? child.value : ""))
    .join("")
    .replace(/\n$/, "")

  return { lang, text }
}

const components: Components = {
  // Обёртка с прокруткой: широкая таблица иначе растянет всю страницу, а из
  // markdown такую обёртку задать нельзя — её ставит только рендерер (§8).
  table: ({ node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  ),

  // Картинка без src — это вырезанный санитайзером мусор, а не картинка.
  // next/image для `data:`-URI не годится (контракт §4), поэтому обычный <img>.
  img: ({ node, src, alt, ...props }) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={String(src)} alt={alt ?? ""} {...props} />
    ) : null,

  // Ссылки из описания ведут наружу: новая вкладка и никакого доступа к
  // window.opener.
  a: ({ node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer nofollow" />
  ),

  // Диаграмма перехватывается на `pre`, а не на `code`: контейнер схемы —
  // блочный элемент, внутри <pre> ему делать нечего. Незнакомый язык фенса
  // остаётся обычным блоком кода (§5).
  pre: ({ node, children, ...props }) => {
    const fence = fenceInfo(node)
    if (fence && fence.lang === "mermaid" && fence.text.trim()) {
      return <MermaidBlock chart={fence.text} />
    }
    return <pre {...props}>{children}</pre>
  },
}

export interface MarkdownViewProps {
  children: string
  className?: string
  /** Ширина колонки текста; контейнер при этом тянется. */
  measure?: number | string
  /** Базовый кегль: остальная типографика считается от него в `em`. */
  fontSize?: number
}

export function MarkdownView({
  children,
  className,
  measure,
  fontSize,
}: MarkdownViewProps) {
  // Кегль и ширина колонки — CSS-переменные, а не классы: значения приходят
  // числом из настройки просмотра (как в simple-mode.tsx с `--in-width`).
  const style = {
    ...(measure === undefined
      ? {}
      : { "--md-measure": typeof measure === "number" ? `${measure}px` : measure }),
    ...(fontSize === undefined ? {} : { "--md-font-size": `${fontSize}px` }),
  } as React.CSSProperties

  return (
    <div className={cn("md-body md-palette", className)} style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, descriptionSanitizeSchema]]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
