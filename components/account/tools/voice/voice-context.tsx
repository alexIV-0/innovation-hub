"use client"

import { createContext, useContext } from "react"

import type {
  Cue,
  DialogDoc,
  Track,
  TrackVoice,
  VoiceTake,
} from "@/lib/tools/dialog/dialog-doc"
import type { Peaks } from "@/lib/tools/dialog/peaks"
import type { TakeAdjustment } from "@/lib/tools/dialog/voice"
import type { EditorClock, TrackFlags, TrackMode } from "../shared/editor-state"
import type { TaskVideo } from "../shared/use-task-folder"
import type { VoicePrefs } from "./prefs"

/**
 * Состояние генерации — на пару «реплика + язык».
 *
 * В документ не пишется: это состояние интерфейса, а не результат работы
 * (правило §2.8 контракта формата). Готовый тейк — это уже запись в документе, и
 * дальше он живёт по обычным правилам: автосохранение, слияние, отмена.
 */
export type GenState =
  | { kind: "idle" }
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "failed"; message: string }

/**
 * Что звучит вместе с кадром.
 *
 * У озвучки по умолчанию слышно **сгенерированное**: человек проверяет дубляж, а
 * не оригинал. Обратное — по кнопке, чтобы сравнить.
 */
export type VoiceSoundMode = "takes" | "original"

export type VoiceApi = {
  doc: DialogDoc
  /** Имя папки задачи — основа имён выгружаемых файлов. */
  taskName: string
  durationMs: number
  mediaEndMs: number

  prefs: VoicePrefs
  setPref: <K extends keyof VoicePrefs>(key: K, value: VoicePrefs[K]) => void
  resetView: () => void
  /** Пикселей на секунду. */
  pps: number
  setPps: (value: number) => void

  /**
   * Язык, который озвучиваем.
   *
   * Всегда конкретный код: озвучить можно и оригинал (перезапись), и любой
   * перевод, но «ничего» — нельзя, поэтому `null` здесь не бывает.
   */
  lang: string
  setLang: (lang: string) => void

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
  trackMode: TrackMode
  setTrackMode: (mode: TrackMode) => void

  clock: EditorClock
  /** Видео задачи: файл в папке, ссылка на него или причина, почему кадра нет. */
  video: TaskVideo
  /** Волна дорожки: своя, если есть, иначе общая. */
  peaksFor: (trackId: string) => { peaks: Peaks | null; own: boolean }
  mainPeaks: Peaks | null
  /** Волна тейка — по её файлу рисуется клип. */
  peaksForTake: (take: VoiceTake) => Peaks | null
  /** Подписанная ссылка на файл тейка; `null` — ещё не готова или файла нет. */
  takeUrl: (take: VoiceTake) => string | null
  /**
   * Подписать файл тейка по требованию.
   *
   * `takeUrl` держит ссылки только на то, что звучит: выбранные тейки текущего
   * языка. Экспорту этого мало — он берёт и прошлые языки, и невыбранные
   * дорожки, — поэтому просит ссылку в момент выгрузки.
   */
  signTake: (take: VoiceTake) => Promise<string | null>

  /** Дорожки после фильтра по имени и shy. */
  visibleTracks: Track[]
  /** Реплики в порядке списка: по времени, с учётом поиска. */
  rows: Cue[]

  soundMode: VoiceSoundMode
  setSoundMode: (mode: VoiceSoundMode) => void
  /** Звук видео заглушён: слушают озвучку. */
  mainMuted: boolean
  /** Тейки, которые сейчас звучат, — по матрице §5.2 плана. */
  audibleTakes: { cue: Cue; take: VoiceTake }[]

  /** Состояние генерации реплики на текущем языке. */
  genState: (cueId: string) => GenState
  /** Сколько реплик в очереди и в работе. */
  genPending: number
  generate: (cueId: string) => void
  generateAll: () => void
  cancelAll: () => void

  ops: {
    /**
     * Разметка для синтеза. `gesture` склеивает набор текста в один шаг отмены:
     * правка дописывается в документ по ходу, а не только когда ушли из поля.
     */
    setMarkup: (cueId: string, markup: string, gesture?: string) => void
    clearMarkup: (cueId: string) => void
    selectTake: (cueId: string, takeId: string) => void
    removeTake: (cueId: string, takeId: string) => void
    /** Убрать все версии реплики на текущем языке. */
    removeTakes: (cueId: string) => void
    adjustTake: (cueId: string, takeId: string, patch: TakeAdjustment, gesture?: string) => void
    resetTake: (cueId: string, takeId: string) => void
    fitTake: (cueId: string, takeId: string) => void
    setTrackVoice: (trackId: string, patch: Partial<TrackVoice>) => void
    renameTrack: (trackId: string, name: string) => void
    setTrackColor: (trackId: string, color: string) => void
    moveTrack: (trackId: string, direction: -1 | 1) => void
    removeTrack: (trackId: string) => void
    undo: () => void
    redo: () => void
  }

  openSettings: () => void
  openHelp: () => void
}

const VoiceContext = createContext<VoiceApi | null>(null)

export const VoiceProvider = VoiceContext.Provider

export function useVoice(): VoiceApi {
  const value = useContext(VoiceContext)
  if (!value) throw new Error("useVoice must be used within VoiceProvider")
  return value
}
