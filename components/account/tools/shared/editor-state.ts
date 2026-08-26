"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

/**
 * Состояние редактора, общее для всех инструментов раздела.
 *
 * Здесь только то, что не знает ни про титры, ни про озвучку: документ с
 * историей, часы плеера, настройки вида и удержание клавиши. Набор инструментов,
 * раскладка клавиш и состав настроек у каждого инструмента свои и живут рядом с
 * ним (`srt/prefs.ts` и подобные).
 */

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
 * показывать волну этой дорожки или нет. Что звучит, решают `solo` и `mute`
 * (§15.3); волна на звук не влияет и наоборот — иначе одна кнопка делала бы
 * две разные вещи.
 */
export type TrackFlags = { solo: boolean; mute: boolean; shy: boolean; wave: boolean }

/**
 * Как сведён звук превью (§15.3).
 *
 * `main` — звучит основная дорожка, звук видео; `solo` — звучат только
 * выбранные дорожки; `mute` — звучат все, кроме выключенных. Режим один на
 * редактор, а не флаг на дорожке: `solo` и `mute` — два способа разобрать один
 * и тот же микс, и одновременно они означали бы взаимоисключающие вещи.
 * Поэтому `solo` старше: пока он включён хоть у одной дорожки, `mute` на
 * других ничего не решает.
 */
export type SoundMode = "main" | "solo" | "mute"

/**
 * Что делают кнопки в строке дорожки.
 *
 * `none` — обычные mute/solo/shy. Перестановка и удаление — отдельные режимы, и
 * они подменяют эти кнопки, а не добавляются к ним: строка узкая, а главное —
 * рука, потянувшаяся к стрелке, не должна попадать в корзину.
 */
export type TrackMode = "none" | "reorder" | "delete"

/**
 * Документ с историей.
 *
 * Undo — стек снимков, а не обратных операций: документ невелик (тысячи реплик
 * это единицы мегабайт), а обратные операции пришлось бы писать и отлаживать
 * для каждой правки отдельно (§18.2). Глубина ограничена, чтобы час работы не
 * съел память вкладки.
 */
const HISTORY_LIMIT = 100

export function useUndoableDoc<T>(initial: T | null) {
  const [doc, setDoc] = useState<T | null>(initial)
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const lastGesture = useRef<string | null>(null)
  const [version, setVersion] = useState(0)

  const reset = useCallback((next: T | null) => {
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
    (fn: (current: T) => T, gesture?: string) => {
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
export function useViewPrefs<P extends object>(storageKey: string, defaults: P) {
  const [prefs, setPrefs] = useState<P>(defaults)
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  useEffect(() => {
    const base = defaultsRef.current
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (!raw) {
        setPrefs(base)
        return
      }
      setPrefs(mergePrefs(base, JSON.parse(raw) as Partial<P>))
    } catch {
      setPrefs(base)
    }
  }, [storageKey])

  const setPref = useCallback(
    <K extends keyof P>(key: K, value: P[K]) => {
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
    setPrefs(defaultsRef.current)
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // см. выше
    }
  }, [storageKey])

  return { prefs, setPref, resetPrefs }
}

/**
 * Слияние сохранённых настроек со значениями по умолчанию.
 *
 * Вложенные объекты сливаются, а не заменяются: в сохранённой раскладке клавиш
 * может не быть действия, которое появилось позже, и оно осталось бы без клавиши.
 */
function mergePrefs<P extends object>(defaults: P, saved: Partial<P>): P {
  const out = { ...defaults }
  for (const [key, value] of Object.entries(saved)) {
    const base = (defaults as Record<string, unknown>)[key]
    const nested =
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base != null &&
      typeof base === "object" &&
      !Array.isArray(base)
    ;(out as Record<string, unknown>)[key] = nested
      ? { ...(base as object), ...(value as object) }
      : value
  }
  return out
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
export function useHeldTool<T extends string>(tool: T, setTool: (next: T) => void) {
  const held = useRef<{ code: string; previous: T; at: number } | null>(null)
  // Текущий инструмент — через ref: обработчик клавиш вешается на окно один раз,
  // и без ref он запомнил бы тот инструмент, который был активен при подписке.
  const current = useRef(tool)
  current.current = tool

  const press = useCallback(
    (code: string, next: T, repeat: boolean) => {
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
