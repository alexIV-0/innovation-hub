/**
 * Экспорт документа в SRT и WebVTT (§12 плана).
 *
 * Текст на выходе обязан совпадать до байта с тем, что даст локальный редактор
 * программы, — поэтому здесь только чистые функции и никаких настроек, кроме
 * тех, что переданы явно (§20.1).
 *
 * Выгрузка задаётся тремя независимыми осями, а не списком готовых вариантов:
 *
 * - **раскладка** — все дорожки в один файл (обычные титры к видео) или по файлу
 *   на персонажа (с ними дальше работают отдельно: озвучка, вычитка);
 * - **дорожки** — какие именно;
 * - **языки** — оригинал и любые переводы, сколько угодно за раз.
 *
 * Сколько получится файлов и как они назовутся, решает `buildExport`: один файл
 * отдаётся файлом, несколько — архивом. Это единственное место, где принимается
 * такое решение, поэтому интерфейсу не приходится знать про имена.
 */

import { compareCues, translationOf, type Cue, type DialogDoc, type Track } from "./dialog-doc"
import { formatSrtTc } from "./timecode"
import { safeEntryName, type ZipEntry } from "./zip"

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

export type ExportedFile = {
  text: string
  mime: string
  extension: string
}

export function exportDocument(
  doc: DialogDoc,
  format: ExportFormat,
  options: ExportOptions,
): ExportedFile {
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

export function extensionOf(format: ExportFormat): string {
  return format === "vtt" ? "vtt" : "srt"
}

/**
 * Имя дорожки в имени файла: номер впереди, чтобы файлы сортировались так же,
 * как дорожки на таймлинии, а не по алфавиту персонажей.
 */
export function trackFileBase(track: Track): string {
  return `${String(track.no).padStart(2, "0")}-${safeEntryName(track.name)}`
}

/**
 * Имя выгружаемого файла.
 *
 * Задача, потом дорожка (если она одна), потом язык, потом расширение:
 * `Notting_Hill.01-Anna.es.srt`. По имени должно быть видно, что внутри, без
 * открытия — файлы разъезжаются по чужим машинам и папкам.
 */
export function exportFileName(input: {
  task: string
  track?: Track | null
  lang: string
  extension: string
}): string {
  const parts = [safeEntryName(input.task)]
  if (input.track) parts.push(trackFileBase(input.track))
  parts.push(input.lang, input.extension)
  return parts.join(".")
}

/** Сколько реплик уедет в выгрузку — цифра для окна экспорта. */
export function countExportedCues(doc: DialogDoc, trackIds: string[]): number {
  const wanted = new Set(trackIds)
  return doc.cues.filter((cue) => wanted.has(cue.trackId)).length
}

/** Одним файлом — обычные титры к видео; по дорожке — титры каждого персонажа. */
export type ExportLayout = "single" | "per-track"

export type ExportPlan = {
  format: ExportFormat
  /** Языки выгрузки; `null` в списке — оригинал. */
  langs: (string | null)[]
  trackIds: string[]
  layout: ExportLayout
}

export type ExportResult =
  | { kind: "file"; name: string; text: string; mime: string }
  | { kind: "archive"; name: string; entries: ZipEntry[]; files: number }

/** Код языка в именах: у оригинала он берётся из документа, а не пишется словом. */
export function langCode(doc: DialogDoc, lang: string | null): string {
  return lang ?? doc.languages.original
}

/**
 * Что именно уедет к человеку.
 *
 * Раскладка и имена решаются здесь, а не в интерфейсе: одно правило на все
 * случаи проще объяснить и проверить, чем четыре ветки в обработчике кнопки.
 *
 * Правило: **один файл отдаётся файлом, несколько — архивом**, а внутри архива
 * язык становится папкой. Так набор из трёх языков и пяти дорожек не
 * превращается в пятнадцать имён, различающихся суффиксом, — и раскладка
 * совпадает с той, что описана для папки `exports/`.
 *
 * `null` — выгружать нечего: не выбрана ни одна дорожка или ни один язык.
 */
export function buildExport(
  doc: DialogDoc,
  task: string,
  plan: ExportPlan,
): ExportResult | null {
  const extension = extensionOf(plan.format)
  const wanted = new Set(plan.trackIds)
  const tracks = doc.tracks
    .filter((track) => wanted.has(track.id))
    .slice()
    .sort((a, b) => a.no - b.no)
  if (tracks.length === 0 || plan.langs.length === 0) return null

  const pieces: { lang: string | null; track: Track | null; text: string; mime: string }[] = []
  for (const lang of plan.langs) {
    if (plan.layout === "single") {
      // Одним файлом — но только выбранные дорожки: `exportDocument` умеет либо
      // одну дорожку, либо все, поэтому лишние реплики отсекаем до него.
      const trimmed = { ...doc, cues: doc.cues.filter((cue) => wanted.has(cue.trackId)) }
      const file = exportDocument(trimmed, plan.format, { lang })
      pieces.push({ lang, track: null, text: file.text, mime: file.mime })
      continue
    }
    for (const track of tracks) {
      const file = exportDocument(doc, plan.format, { lang, trackId: track.id })
      pieces.push({ lang, track, text: file.text, mime: file.mime })
    }
  }

  if (pieces.length === 1) {
    const only = pieces[0]
    return {
      kind: "file",
      name: exportFileName({
        task,
        track: only.track,
        lang: langCode(doc, only.lang),
        extension,
      }),
      text: only.text,
      mime: only.mime,
    }
  }

  return {
    kind: "archive",
    name: `${safeEntryName(task)}.zip`,
    files: pieces.length,
    entries: pieces.map((piece) => ({
      name: `${safeEntryName(langCode(doc, piece.lang))}/${
        piece.track ? trackFileBase(piece.track) : safeEntryName(task)
      }.${extension}`,
      text: piece.text,
    })),
  }
}
