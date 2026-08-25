/**
 * Экспорт документа в SRT и WebVTT (§12).
 *
 * Текст на выходе обязан совпадать до байта с тем, что даст локальный редактор
 * программы, — поэтому здесь только чистые функции и никаких настроек, кроме
 * тех, что переданы явно (§20.1).
 */

import { compareCues, translationOf, type Cue, type DialogDoc } from "./dialog-doc"
import { formatSrtTc } from "./timecode"

export type ExportFormat = "srt" | "srt-bom" | "vtt"

export type ExportOptions = {
  /** `null` — оригинал; иначе код языка перевода. */
  lang: string | null
  /** Пусто — все дорожки в один файл, как обычные титры. */
  trackId?: string | null
}

export function exportCues(doc: DialogDoc, options: ExportOptions): Cue[] {
  return doc.cues
    .filter((c) => (options.trackId ? c.trackId === options.trackId : true))
    .slice()
    .sort(compareCues)
}

export function toSrt(doc: DialogDoc, options: ExportOptions): string {
  const cues = exportCues(doc, options)
  const blocks = cues.map((cue, index) => {
    const text = options.lang ? translationOf(cue, options.lang) : cue.text
    return (
      `${index + 1}\n` +
      `${formatSrtTc(cue.startMs)} --> ${formatSrtTc(cue.endMs)}\n` +
      `${text.trim()}\n`
    )
  })
  // Пустая строка между блоками и перевод строки в конце файла — часть формата:
  // плееры, которые читают SRT построчно, без них склеивают последние два титра.
  return blocks.join("\n")
}

export function toVtt(doc: DialogDoc, options: ExportOptions): string {
  const cues = exportCues(doc, options)
  const blocks = cues.map((cue) => {
    const text = options.lang ? translationOf(cue, options.lang) : cue.text
    return (
      `${formatSrtTc(cue.startMs).replace(",", ".")} --> ` +
      `${formatSrtTc(cue.endMs).replace(",", ".")}\n` +
      `${text.trim()}\n`
    )
  })
  return `WEBVTT\n\n${blocks.join("\n")}`
}

export function exportDocument(
  doc: DialogDoc,
  format: ExportFormat,
  options: ExportOptions,
): { text: string; mime: string; extension: string } {
  if (format === "vtt") {
    return { text: toVtt(doc, options), mime: "text/vtt;charset=utf-8", extension: "vtt" }
  }
  const body = toSrt(doc, options)
  // BOM ставим только по явной просьбе: часть монтажных программ без него
  // читает кириллицу как «кракозябры», остальные — наоборот, показывают BOM
  // первым символом первого титра.
  const text = format === "srt-bom" ? `﻿${body}` : body
  return { text, mime: "application/x-subrip;charset=utf-8", extension: "srt" }
}
