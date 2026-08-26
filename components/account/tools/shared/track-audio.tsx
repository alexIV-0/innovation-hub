"use client"

import { useEffect, useRef } from "react"

import type { EditorClock } from "./editor-state"

/** Расхождение, после которого дорожку возвращают на место (§15.2). */
const MAX_DRIFT_MS = 40
/** Чаще этого не поправляем: каждая правка `currentTime` — щелчок в звуке. */
const FIX_COOLDOWN_MS = 250

/**
 * Звук, идущий вместе с превью: стем дорожки или тейк озвучки.
 *
 * Своих часов у него нет: время задаёт плеер превью, а звук только за ним
 * поспевает. Порог 40 мс — половина типичной длительности слога: меньше
 * человек не слышит, больше — уже эхо.
 *
 * Это `<audio>`, а не WebAudio: пока у задач нет стемов, проверить сведение
 * нескольких источников не на чем, а один-два элемента с поправкой по дрейфу
 * ведут себя предсказуемо. Когда стемы появятся, смена движка не заденет
 * остальной код — наружу торчит только этот компонент.
 */
export function TrackAudio({
  url,
  playing,
  clock,
  startMs = 0,
  rate = 1,
  gainDb = 0,
}: {
  url: string
  playing: boolean
  clock: EditorClock
  /**
   * Когда звук начинается на таймлинии. У стема дорожки это ноль — он идёт от
   * начала материала; у тейка озвучки — начало его реплики.
   */
  startMs?: number
  rate?: number
  gainDb?: number
}) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const lastFix = useRef(0)

  /**
   * Время внутри файла для данного момента таймлинии.
   *
   * Отрицательное — момент ещё не дошёл до начала звука; больше длительности —
   * уже прошёл. И то и другое означает «молчать».
   */
  const localTime = (ms: number) => ((ms - startMs) / 1000) * rate

  // Скорость и громкость — свойства элемента, а не обработка звука. Браузер
  // сохраняет высоту голоса при смене `playbackRate` (`preservesPitch` включён
  // по умолчанию), поэтому ускоренная речь не звучит выше.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.playbackRate = rate
    // `volume` умеет только приглушать. Плюсовое усиление в превью не слышно —
    // это ограничение элемента, а не решение; для рендера усиление применяется
    // честно.
    el.volume = Math.min(1, Math.pow(10, gainDb / 20))
  }, [gainDb, rate])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const at = localTime(clock.getTimeMs())
    if (playing && at >= 0) {
      el.currentTime = at
      void el.play().catch(() => undefined)
    } else {
      el.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, playing, startMs, rate])

  useEffect(() => {
    return clock.subscribe((ms) => {
      const el = ref.current
      if (!el) return
      const at = localTime(ms)
      // Вне своего отрезка звук молчит: играть его с середины некорректно, а
      // держать в паузе — ровно то, что нужно.
      if (at < 0 || (el.duration && at > el.duration)) {
        if (!el.paused) el.pause()
        return
      }
      if (playing && el.paused) void el.play().catch(() => undefined)
      const drift = Math.abs(el.currentTime - at) * 1000
      if (drift <= MAX_DRIFT_MS) return
      const now = performance.now()
      // На паузе поправляем сразу: это перемотка, а не дрейф.
      if (playing && now - lastFix.current < FIX_COOLDOWN_MS) return
      lastFix.current = now
      el.currentTime = at
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, playing, startMs, rate])

  return <audio ref={ref} src={url} preload="auto" className="hidden" />
}
