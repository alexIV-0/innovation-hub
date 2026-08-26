"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { DialogDoc } from "@/lib/tools/srt/dialog-doc"
import type { ExportFormat } from "@/lib/tools/srt/export"

/** Инструмент таймлинии: выделение, создание, разрез, перенос, объединение. */
export type TimelineTool = "select" | "create" | "razor" | "shift" | "merge"

/** Действия, у которых есть горячая клавиша и которые можно переназначить. */
export type HotkeyAction = TimelineTool | "playPause" | "mainWave"

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  "select",
  "create",
  "razor",
  "shift",
  "merge",
  "playPause",
  "mainWave",
]

/**
 * Клавиши хранятся кодом физической кнопки (`KeyB`), а не набранным символом.
 *
 * `event.key` зависит от раскладки: на русской та же кнопка даёт «и», и
 * привязка к букве просто перестаёт работать, пока не переключишь язык.
 * `event.code` описывает кнопку, поэтому раскладку можно не трогать.
 */
export type Keymap = Record<HotkeyAction, string>

export const DEFAULT_KEYMAP: Keymap = {
  select: "KeyV",
  create: "KeyC",
  razor: "KeyB",
  shift: "KeyM",
  merge: "KeyJ",
  playPause: "Space",
  mainWave: "KeyW",
}

/** Подпись клавиши для интерфейса: `KeyB` → `B`, `Digit1` → `1`. */
export function keyLabel(code: string): string {
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`
  if (code.startsWith("Arrow")) return code.slice(5)
  return code
}

/**
 * Состояние дорожки, которого нет в документе.
 *
 * `solo`, `mute` и `shy` — это вид (§2.8 контракта формата), `wave` — тоже:
 * показывать волну этой дорожки или нет. Что звучит, решает `solo`; волна на
 * звук не влияет и наоборот — иначе одна кнопка делала бы две разные вещи.
 */
export type TrackFlags = { solo: boolean; mute: boolean; shy: boolean; wave: boolean }

/**
 * Что делают кнопки в строке дорожки.
 *
 * `none` — обычные mute/solo/shy. Перестановка и удаление — отдельные режимы, и
 * они подменяют эти кнопки, а не добавляются к ним: строка узкая, а главное —
 * рука, потянувшаяся к стрелке, не должна попадать в корзину.
 */
export type TrackMode = "none" | "reorder" | "delete"

export type ViewPrefs = {
  trackH: number
  fontSize: number
  snap: boolean
  exportFmt: ExportFormat
  mainWave: boolean
  zoom: number
  keymap: Keymap
}

export const DEFAULT_PREFS: ViewPrefs = {
  trackH: 52,
  fontSize: 14,
  snap: true,
  exportFmt: "srt",
  mainWave: true,
  zoom: 64,
  keymap: DEFAULT_KEYMAP,
}

/** Размеры зон по умолчанию — из дизайна. */
export const DEFAULT_LEFT_W = 420
export const DEFAULT_TIMELINE_H = 300

/**
 * Документ с историей.
 *
 * Undo — стек снимков, а не обратных операций: документ невелик (тысячи реплик
 * это единицы мегабайт), а обратные операции пришлось бы писать и отлаживать
 * для каждой правки отдельно (§18.2). Глубина ограничена, чтобы час работы не
 * съел память вкладки.
 */
const HISTORY_LIMIT = 100

export function useUndoableDoc(initial: DialogDoc | null) {
  const [doc, setDoc] = useState<DialogDoc | null>(initial)
  const past = useRef<DialogDoc[]>([])
  const future = useRef<DialogDoc[]>([])
  const lastGesture = useRef<string | null>(null)
  const [version, setVersion] = useState(0)

  const reset = useCallback((next: DialogDoc | null) => {
    past.current = []
    future.current = []
    lastGesture.current = null
    setDoc(next)
    setVersion((v) => v + 1)
  }, [])

  /**
   * Правка документа. Возврат того же объекта = ничего не произошло.
   *
   * `gesture` склеивает шаги одного движения: перетаскивание клипа даёт правку
   * на каждый кадр мыши, и без склейки одно «отменить» возвращало бы клип на
   * пиксель назад — шестьдесят раз подряд.
   */
  const apply = useCallback(
    (fn: (current: DialogDoc) => DialogDoc, gesture?: string) => {
      setDoc((current) => {
        if (!current) return current
        const next = fn(current)
        if (next === current) return current
        if (!gesture || lastGesture.current !== gesture) {
          past.current = past.current.concat([current]).slice(-HISTORY_LIMIT)
        }
        lastGesture.current = gesture ?? null
        future.current = []
        return next
      })
      setVersion((v) => v + 1)
    },
    [],
  )

  const undo = useCallback(() => {
    setDoc((current) => {
      const prev = past.current.pop()
      if (!prev || !current) return current
      future.current = future.current.concat([current])
      return prev
    })
    setVersion((v) => v + 1)
  }, [])

  const redo = useCallback(() => {
    setDoc((current) => {
      const next = future.current.pop()
      if (!next || !current) return current
      past.current = past.current.concat([current])
      return next
    })
    setVersion((v) => v + 1)
  }, [])

  return {
    doc,
    apply,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    /** Растёт на каждой правке — по нему видно, что есть несохранённое. */
    version,
  }
}

/**
 * Настройки вида экземпляра инструмента.
 *
 * Живут в `localStorage` по ключу инструмента, а не в `user_tools.settings`:
 * высота дорожек и размер шрифта — свойство экрана, за которым сидят, и тащить
 * их между машинами через базу было бы неверно (§9).
 */
export function useViewPrefs(toolId: string) {
  const storageKey = `ffworks-srt-view:${toolId}`
  const [prefs, setPrefs] = useState<ViewPrefs>(DEFAULT_PREFS)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) {
        setPrefs(DEFAULT_PREFS)
        return
      }
      const saved = JSON.parse(raw) as Partial<ViewPrefs>
      // Клавиши сливаем, а не заменяем: у сохранённой раскладки может не быть
      // действия, которое появилось позже, и оно осталось бы без клавиши.
      setPrefs({
        ...DEFAULT_PREFS,
        ...saved,
        keymap: { ...DEFAULT_KEYMAP, ...(saved.keymap ?? {}) },
      })
    } catch {
      setPrefs(DEFAULT_PREFS)
    }
  }, [storageKey])

  const setPref = useCallback(
    <K extends keyof ViewPrefs>(key: K, value: ViewPrefs[K]) => {
      setPrefs((current) => {
        const next = { ...current, [key]: value }
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next))
        } catch {
          // Приватный режим: настройки просто не переживут перезагрузку.
        }
        return next
      })
    },
    [storageKey],
  )

  const resetPrefs = useCallback(() => {
    setPrefs(DEFAULT_PREFS)
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // см. выше
    }
  }, [storageKey])

  return { prefs, setPref, resetPrefs }
}

/**
 * Часы редактора.
 *
 * Источник времени один: если в папке есть видео — это `<video>`, если нет —
 * программный таймер. Второй источник времени означал бы рассинхрон, который
 * потом невозможно поймать (§15.1). Поверхность у обоих одинаковая, поэтому
 * таймлиния и список разницы не видят.
 *
 * Время наружу отдаётся подпиской, а не состоянием React. Это не преждевременная
 * оптимизация: при 60 кадрах в секунду `setState` перерисовывал бы весь редактор
 * вместе со списком реплик — на паре тысяч строк это заметно даже без записи.
 * Подписываются только те, кому время правда нужно: курсор, часы транспорта и
 * титры поверх кадра.
 */
export type EditorClock = {
  getTimeMs: () => number
  subscribe: (listener: (ms: number) => void) => () => void
  seek: (ms: number) => void
  playing: boolean
  togglePlay: () => void
  pause: () => void
}

export function usePlayerClock(
  media: React.RefObject<HTMLVideoElement | null>,
  durationMs: number,
): EditorClock {
  const [playing, setPlaying] = useState(false)
  const timeRef = useRef(0)
  const listeners = useRef(new Set<(ms: number) => void>())
  const playingRef = useRef(false)
  playingRef.current = playing
  const durationRef = useRef(durationMs)
  durationRef.current = durationMs

  const publish = useCallback((ms: number) => {
    timeRef.current = ms
    for (const listener of listeners.current) listener(ms)
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const el = media.current
      if (el && el.readyState > 0) {
        publish(el.currentTime * 1000)
      } else if (playingRef.current) {
        const next = Math.min(durationRef.current, timeRef.current + (now - last))
        publish(next)
        if (next >= durationRef.current) setPlaying(false)
      }
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [media, publish])

  const subscribe = useCallback((listener: (ms: number) => void) => {
    listeners.current.add(listener)
    listener(timeRef.current)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(durationRef.current, ms))
      publish(clamped)
      const el = media.current
      if (el && el.readyState > 0) el.currentTime = clamped / 1000
    },
    [media, publish],
  )

  const togglePlay = useCallback(() => {
    const el = media.current
    setPlaying((current) => {
      const next = !current
      if (el && el.readyState > 0) {
        if (next) void el.play().catch(() => undefined)
        else el.pause()
      }
      return next
    })
  }, [media])

  const pause = useCallback(() => {
    const el = media.current
    if (el && el.readyState > 0) el.pause()
    setPlaying(false)
  }, [media])

  return useMemo(
    () => ({ getTimeMs: () => timeRef.current, subscribe, seek, playing, togglePlay, pause }),
    [pause, playing, seek, subscribe, togglePlay],
  )
}

/** Порог, отделяющий короткое нажатие от удержания. */
const HOLD_MS = 260

/**
 * Временный инструмент: клавишу можно зажать.
 *
 * Пока держите — инструмент активен, отпустили — вернулся предыдущий; короткое
 * нажатие переключает насовсем.
 */
export function useHeldTool(tool: TimelineTool, setTool: (next: TimelineTool) => void) {
  const held = useRef<{ code: string; previous: TimelineTool; at: number } | null>(null)
  // Текущий инструмент — через ref: обработчик клавиш вешается на окно один раз,
  // и без ref он запомнил бы тот инструмент, который был активен при подписке.
  const current = useRef(tool)
  current.current = tool

  const press = useCallback(
    (code: string, next: TimelineTool, repeat: boolean) => {
      // Повтор от удержания игнорируем: жест начинается один раз.
      if (repeat) return
      if (!held.current) held.current = { code, previous: current.current, at: Date.now() }
      setTool(next)
    },
    [setTool],
  )

  const release = useCallback(
    (code: string) => {
      const state = held.current
      if (!state || state.code !== code) return
      held.current = null
      // Держали дольше порога — это временный инструмент, возвращаем прежний.
      // Короткое нажатие переключает насовсем.
      if (Date.now() - state.at >= HOLD_MS) setTool(state.previous)
    },
    [setTool],
  )

  return useMemo(() => ({ press, release }), [press, release])
}
