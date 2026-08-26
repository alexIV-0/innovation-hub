"use client"

import { createContext, useContext } from "react"

import type { Cue, DialogDoc, Track } from "@/lib/tools/srt/dialog-doc"
import type { SrtCue } from "@/lib/tools/srt/srt-parse"
import type { Peaks } from "@/lib/tools/srt/peaks"
import type {
  EditorClock,
  TimelineTool,
  TrackFlags,
  TrackMode,
  ViewPrefs,
} from "./editor-state"

/**
 * Всё состояние редактора одним объектом.
 *
 * Контекст, а не десяток пропсов через три уровня: зоны редактора (превью,
 * список, таймлиния) читают почти одно и то же, и передача руками превратилась
 * бы в сорок пропсов, которые расходятся при первой же правке. Время в контекст
 * не входит — оно идёт подпиской через `clock` (§15.1).
 */
export type SrtApi = {
  doc: DialogDoc
  /** Имя папки задачи — оно же основа имён выгружаемых файлов. */
  taskName: string
  /** Полная длительность: медиа и реплики, что длиннее. */
  durationMs: number
  /** Конец самого медиафайла — дальше него на дорожке серая зона. */
  mediaEndMs: number

  prefs: ViewPrefs
  setPref: <K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]) => void
  resetView: () => void
  /** Пикселей на секунду. */
  pps: number
  setPps: (value: number) => void

  tool: TimelineTool
  setTool: (tool: TimelineTool) => void
  /** `null` — показываем оригинал; иначе код языка перевода. */
  lang: string | null
  setLang: (lang: string | null) => void

  selectedCueId: string | null
  selectedTrackId: string | null
  selectCue: (cueId: string, options?: { seek?: boolean }) => void
  selectTrack: (trackId: string) => void

  cueQuery: string
  setCueQuery: (value: string) => void
  trackQuery: string
  setTrackQuery: (value: string) => void
  hideShy: boolean
  setHideShy: (value: boolean) => void

  flags: Record<string, TrackFlags>
  toggleFlag: (trackId: string, key: keyof TrackFlags) => void

  /**
   * Режим работы с самими дорожками: обычно `none`, а перестановка и удаление
   * включаются кнопками в шапке панели. Режимы, а не всегда видимые кнопки:
   * удаление дорожки уносит её реплики, и такой кнопке не место рядом с mute.
   */
  trackMode: TrackMode
  setTrackMode: (mode: TrackMode) => void

  clock: EditorClock
  videoUrl: string | null
  /**
   * Дорожки, которые сейчас звучат: solo, не mute, свой звук включён и файл
   * есть. Пусто — звучит основная дорожка (звук видео).
   */
  soloTrackIds: string[]
  /** Звук видео заглушён: кто-то включил solo (§15.3). */
  mainMuted: boolean
  /** Ссылка на аудиофайл дорожки, если он подписан. */
  trackAudioUrl: (trackId: string) => string | null
  /** Волна дорожки: своя, если есть, иначе общая (§17.3). */
  peaksFor: (trackId: string) => { peaks: Peaks | null; own: boolean }
  mainPeaks: Peaks | null

  /** Дорожки после фильтра по имени и shy. */
  visibleTracks: Track[]
  /** Реплики в порядке списка: по времени, с учётом поиска. */
  rows: Cue[]

  ops: {
    setText: (cueId: string, text: string) => void
    setTranslation: (cueId: string, lang: string, text: string) => void
    /** `gesture` — признак одного движения мыши: вся протяжка = один шаг отмены. */
    setTiming: (
      cueId: string,
      startMs: number,
      endMs: number,
      trackId?: string,
      gesture?: string,
    ) => void
    addCue: (trackId: string, startMs: number, endMs: number) => string
    removeCue: (cueId: string) => void
    splitCue: (cueId: string, atMs: number) => void
    mergeNext: (cueId: string) => void
    /** Объединить две соседние реплики одной дорожки. Порядок не важен. */
    mergeCues: (aId: string, bId: string) => void
    renameTrack: (trackId: string, name: string) => void
    setTrackColor: (trackId: string, color: string) => void
    removeTrack: (trackId: string) => void
    moveTrack: (trackId: string, direction: -1 | 1) => void
    /** Заменить документ целиком — восстановление проходит через историю отмены. */
    replaceDoc: (next: DialogDoc) => void
    /** Завести язык перевода и сразу переключиться на него. */
    addLanguage: (code: string) => void
    removeLanguage: (code: string) => void
    addTrack: () => void
    undo: () => void
    redo: () => void
  }

  /** Прочитать сырьё титров из папки: нужно восстановлению. */
  loadSources: (paths: string[]) => Promise<Map<string, SrtCue[]>>

  openSettings: () => void
  openHelp: () => void
}

const SrtContext = createContext<SrtApi | null>(null)

export const SrtProvider = SrtContext.Provider

export function useSrt(): SrtApi {
  const value = useContext(SrtContext)
  if (!value) throw new Error("useSrt must be used within SrtProvider")
  return value
}
