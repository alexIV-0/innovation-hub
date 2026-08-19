/**
 * Что делает каждая кнопка тулбара — поверх чистых функций `markdown-commands`.
 *
 * Отдельный слой, а не вызовы команд прямо из панели: тулбар не должен знать ни
 * про синтаксис markdown, ни про имена классов палитры. За этим интерфейсом
 * стоят две реализации — правка текстом (здесь) и правка в отрисованном виде
 * (`tiptap-api.ts`), — и панель кнопок у них общая, как в программе.
 */

import type { AlignKind } from "./description-format"
import {
  applySpanClass,
  changeIndent,
  insertFence,
  insertHr,
  insertImage,
  insertLink,
  insertTable,
  insertText,
  setHeading,
  stripFormatting,
  toggleLinePrefix,
  toggleTag,
  toggleWrap,
  wrapAlign,
  wrapDetails,
  wrapIndentParagraph,
  type TextState,
} from "./markdown-commands"

export type ListKind = "ul" | "ol" | "check"

export interface EditorApi {
  bold(): void
  italic(): void
  underline(): void
  strike(): void
  inlineCode(): void
  /** `key = null` снимает цвет или заливку. */
  color(kind: "fg" | "bg", key: string | null): void
  clearFormat(): void
  heading(level: 0 | 1 | 2 | 3 | 4): void
  indentParagraph(): void
  align(kind: AlignKind): void
  quote(): void
  hr(): void
  details(): void
  list(kind: ListKind): void
  indent(delta: 1 | -1): void
  link(text: string, url: string): void
  image(alt: string, src: string): void
  table(cols: number, rows: number, header: boolean): void
  codeBlock(lang: string): void
  mermaid(): void
  insert(text: string): void
  /** Выделенный текст — для подстановки в диалог ссылки. */
  selection(): string
  /**
   * Стоит ли каретка внутри такого форматирования — для подсветки кнопки.
   *
   * Честно отвечает только правка в отрисованном виде: там есть документ, у
   * которого можно спросить. В текстовом режиме состояние пришлось бы угадывать
   * по синтаксису вокруг каретки, а угаданная подсветка хуже её отсутствия.
   */
  isActive(name: string): boolean
}

/** Каркас блок-схемы: сразу видно, что рисуется, и куда дописывать. */
export const MERMAID_SKELETON = "flowchart LR\n  A --> B"

/**
 * Подписи, которые команды кладут В ФАЙЛ, а не в интерфейс: заголовок спойлера
 * и названия столбцов таблицы. Поэтому они приходят из словаря снаружи, а не
 * зашиты в чистых функциях.
 */
export interface EditorApiLabels {
  detailsSummary: string
  tableColumn: (index: number) => string
}

export function createTextApi(
  apply: (fn: (s: TextState) => TextState) => void,
  read: () => TextState,
  labels: EditorApiLabels,
): EditorApi {
  return {
    bold: () => apply((s) => toggleWrap(s, "**")),
    italic: () => apply((s) => toggleWrap(s, "*")),
    underline: () => apply((s) => toggleTag(s, "u")),
    strike: () => apply((s) => toggleWrap(s, "~~")),
    inlineCode: () => apply((s) => toggleWrap(s, "`")),
    color: (kind, key) => apply((s) => applySpanClass(s, kind, key)),
    clearFormat: () => apply(stripFormatting),
    heading: (level) => apply((s) => setHeading(s, level)),
    indentParagraph: () => apply(wrapIndentParagraph),
    align: (kind) => apply((s) => wrapAlign(s, `align-${kind}`)),
    quote: () => apply((s) => toggleLinePrefix(s, "quote")),
    hr: () => apply(insertHr),
    details: () => apply((s) => wrapDetails(s, labels.detailsSummary)),
    list: (kind) => apply((s) => toggleLinePrefix(s, kind)),
    indent: (delta) => apply((s) => changeIndent(s, delta)),
    link: (text, url) => apply((s) => insertLink(s, text, url)),
    image: (alt, src) => apply((s) => insertImage(s, alt, src)),
    table: (cols, rows, header) =>
      apply((s) => insertTable(s, cols, rows, header, labels.tableColumn)),
    codeBlock: (lang) => apply((s) => insertFence(s, lang)),
    mermaid: () => apply((s) => insertFence(s, "mermaid", MERMAID_SKELETON)),
    insert: (text) => apply((s) => insertText(s, text)),
    selection: () => {
      const s = read()
      return s.value.slice(s.selStart, s.selEnd)
    },
    isActive: () => false,
  }
}
