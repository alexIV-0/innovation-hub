"use client"

import { useEffect, useRef } from "react"

import type { EditorClock } from "./editor-state"

/** Расхождение, после которого дорожку возвращают на место (§15.2). */
const MAX_DRIFT_MS = 40
/** Чаще этого не поправляем: каждая правка `currentTime` — щелчок в звуке. */
const FIX_COOLDOWN_MS = 250

/**
 * Аудио одной дорожки персонажа.
 *
 * Своих часов у неё нет: время задаёт плеер превью, а дорожка только за ним
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
}: {
  url: string
  playing: boolean
  clock: EditorClock
}) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const lastFix = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (playing) {
      el.currentTime = clock.getTimeMs() / 1000
      void el.play().catch(() => undefined)
    } else {
      el.pause()
    }
  }, [clock, playing])

  useEffect(() => {
    return clock.subscribe((ms) => {
      const el = ref.current
      if (!el) return
      const drift = Math.abs(el.currentTime * 1000 - ms)
      if (drift <= MAX_DRIFT_MS) return
      const now = performance.now()
      // На паузе поправляем сразу: это перемотка, а не дрейф.
      if (playing && now - lastFix.current < FIX_COOLDOWN_MS) return
      lastFix.current = now
      el.currentTime = ms / 1000
    })
  }, [clock, playing])

  return <audio ref={ref} src={url} preload="auto" className="hidden" />
}
