/**
 * Что именно выгружается из озвучки.
 *
 * Чистая логика: какие тейки, в какие файлы и под какими именами. Сведение звука
 * — в `render.ts`, оно требует браузера; здесь только решения, и их можно
 * проверить без звука.
 *
 * Правило имён то же, что у титров: **один файл отдаётся файлом, несколько —
 * архивом**, а внутри архива язык становится папкой.
 */

import { exportFileName, trackFileBase } from "../dialog/export"
import { safeEntryName } from "../dialog/zip"
import { selectedTake, takeStartMs } from "../dialog/voice"
import type { Cue, DialogDoc, Track, VoiceTake } from "../dialog/dialog-doc"

/** Одним файлом — сведённый дубляж; по дорожке — отдельно на каждого персонажа. */
export type VoiceExportLayout = "single" | "per-track"

export type VoiceExportPlan = {
  langs: string[]
  trackIds: string[]
  layout: VoiceExportLayout
}

/** Один будущий файл: что в него сводить и как назвать. */
export type VoiceExportPiece = {
  name: string
  lang: string
  sources: { cue: Cue; take: VoiceTake }[]
}

export type VoiceExportResult = {
  kind: "file" | "archive"
  /** Имя одиночного файла или архива. */
  name: string
  pieces: VoiceExportPiece[]
  /** Сколько тейков уедет всего. */
  takes: number
  /**
   * Хотя бы у одного тейка скорость не единица.
   *
   * Важно сказать человеку: в превью браузер сохраняет высоту голоса при смене
   * скорости, а при сведении — нет, и ускоренная речь в файле будет звучать
   * выше, чем он слышал. Пока рендер идёт в браузере, это так.
   */
  resampled: boolean
}

/**
 * Собрать план выгрузки.
 *
 * `null` — выгружать нечего: не выбрана дорожка, язык или нет ни одного тейка.
 * Пустой файл лучше не отдавать вовсе, чем отдать тишину.
 */
export function planVoiceExport(
  doc: DialogDoc,
  task: string,
  plan: VoiceExportPlan,
): VoiceExportResult | null {
  const wanted = new Set(plan.trackIds)
  const tracks = doc.tracks
    .filter((track) => wanted.has(track.id))
    .slice()
    .sort((a, b) => a.no - b.no)
  if (tracks.length === 0 || plan.langs.length === 0) return null

  const pieces: (VoiceExportPiece & { track: Track | null })[] = []
  for (const lang of plan.langs) {
    if (plan.layout === "single") {
      const sources = collect(doc, tracks, lang)
      if (sources.length === 0) continue
      pieces.push({ name: "", lang, track: null, sources })
      continue
    }
    for (const track of tracks) {
      const sources = collect(doc, [track], lang)
      if (sources.length === 0) continue
      pieces.push({ name: "", lang, track, sources })
    }
  }
  if (pieces.length === 0) return null

  const takes = pieces.reduce((sum, piece) => sum + piece.sources.length, 0)
  const resampled = pieces.some((piece) => piece.sources.some(({ take }) => take.rate !== 1))

  if (pieces.length === 1) {
    const only = pieces[0]
    return {
      kind: "file",
      name: exportFileName({
        task,
        track: only.track,
        lang: only.lang,
        extension: "wav",
      }),
      pieces: [{ name: "", lang: only.lang, sources: only.sources }],
      takes,
      resampled,
    }
  }

  return {
    kind: "archive",
    name: `${safeEntryName(task)}.zip`,
    pieces: pieces.map((piece) => ({
      name: `${safeEntryName(piece.lang)}/${
        piece.track ? trackFileBase(piece.track) : safeEntryName(task)
      }.wav`,
      lang: piece.lang,
      sources: piece.sources,
    })),
    takes,
    resampled,
  }
}

/**
 * Сколько тейков даст эта дорожка на этих языках — цифра для окна экспорта.
 *
 * Считается по тому же правилу, что и сама выгрузка (только выбранные тейки),
 * иначе число рядом с дорожкой расходилось бы с тем, что попадёт в файл.
 */
export function countExportedTakes(doc: DialogDoc, trackId: string, langs: string[]): number {
  let count = 0
  for (const cue of doc.cues) {
    if (cue.trackId !== trackId) continue
    for (const lang of langs) if (selectedTake(cue, lang)) count += 1
  }
  return count
}

/**
 * Выбранные тейки этих дорожек на этом языке, по времени.
 *
 * Только выбранные: прежние версии — история, а не результат, и складывать их в
 * один файл значило бы наложить друг на друга несколько прочтений одной реплики.
 */
function collect(
  doc: DialogDoc,
  tracks: Track[],
  lang: string,
): { cue: Cue; take: VoiceTake }[] {
  const ids = new Set(tracks.map((track) => track.id))
  const out: { cue: Cue; take: VoiceTake }[] = []
  for (const cue of doc.cues) {
    if (!ids.has(cue.trackId)) continue
    const take = selectedTake(cue, lang)
    if (take) out.push({ cue, take })
  }
  return out.sort((a, b) => takeStartMs(a.cue, a.take) - takeStartMs(b.cue, b.take))
}
