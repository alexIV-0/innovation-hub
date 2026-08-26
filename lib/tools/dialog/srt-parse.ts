/**
 * Разбор SRT и WebVTT.
 *
 * Нужен не для открытия задачи — документ собирает конвейер, — а для
 * восстановления: файлы `{NN}/orig.srt` и `{NN}/{lang}.srt` в папке никто не
 * меняет, поэтому именно они отвечают на вопрос «а что там было изначально».
 *
 * Разбор терпимый: файлы приходят из чужих программ, и падать на лишней пустой
 * строке или отсутствующем номере блока — не то поведение, которого от него
 * ждут. Что не разобралось, просто не попадает в результат.
 */

export type SrtCue = {
  /** Номер блока: из файла, а если его нет — порядковый. */
  index: number
  startMs: number
  endMs: number
  text: string
}

/** `00:00:26,270` или `0:26.27` — часы и дробная часть необязательны. */
const TIME = /(\d{1,3}):([0-5]?\d):([0-5]?\d)(?:[,.](\d{1,3}))?|(\d{1,3}):([0-5]?\d)(?:[,.](\d{1,3}))?/
const ARROW = /-{2,}>|=>/

export function parseSrt(input: string): SrtCue[] {
  // BOM в начале файла — обычное дело для SRT, он не часть первого номера.
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n")
  const out: SrtCue[] = []

  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((line, i, all) => line.trim() !== "" || i < all.length)
    const trimmed = lines.map((line) => line.trim()).filter((line, i) => line !== "" || i > 0)
    if (trimmed.length === 0) continue

    // Строка таймингов — та, где есть стрелка. Номер блока может быть, может не
    // быть, а в WebVTT перед ней бывает ещё и подпись.
    const arrowAt = trimmed.findIndex((line) => ARROW.test(line))
    if (arrowAt < 0) continue
    const timing = parseTimingLine(trimmed[arrowAt])
    if (!timing) continue

    const numbered = arrowAt > 0 ? Number.parseInt(trimmed[arrowAt - 1], 10) : Number.NaN
    const body = trimmed
      .slice(arrowAt + 1)
      .join("\n")
      .trim()

    out.push({
      index: Number.isFinite(numbered) ? numbered : out.length + 1,
      startMs: timing.startMs,
      endMs: timing.endMs,
      text: body,
    })
  }

  return out
}

function parseTimingLine(line: string): { startMs: number; endMs: number } | null {
  const [left, right] = line.split(ARROW)
  if (!left || !right) return null
  const startMs = parseSrtTime(left)
  const endMs = parseSrtTime(right)
  if (startMs == null || endMs == null || endMs <= startMs) return null
  return { startMs, endMs }
}

/** Один таймкод строки `-->`; лишнее вокруг (координаты WebVTT) игнорируется. */
export function parseSrtTime(value: string): number | null {
  const match = TIME.exec(value.trim())
  if (!match) return null
  const [, h, m, s, frac, mm, ss, frac2] = match
  if (h != null) {
    return (
      Number(h) * 3_600_000 +
      Number(m) * 60_000 +
      Number(s) * 1000 +
      Number((frac ?? "").padEnd(3, "0") || 0)
    )
  }
  return (
    Number(mm) * 60_000 + Number(ss) * 1000 + Number((frac2 ?? "").padEnd(3, "0") || 0)
  )
}

/** Блоки по номеру — так реплика документа находит свой исходный блок. */
export function srtByIndex(cues: SrtCue[]): Map<number, SrtCue> {
  const map = new Map<number, SrtCue>()
  for (const cue of cues) {
    if (!map.has(cue.index)) map.set(cue.index, cue)
  }
  return map
}
