/**
 * Система координат таймлинии и всё, что из неё следует: линейка, зум,
 * прилипание. Чистые функции без DOM — переносятся в программу как есть (§20.1).
 *
 * Горизонтальная прокрутка — обычный скролл контейнера, поэтому `viewStartMs` в
 * координатах не участвует: полотно рисуется целиком, а браузер показывает его
 * часть. Одна пара функций, через которую проходит всё остальное.
 */

/** Масштаб — пикселей на секунду. Границы взяты из дизайна. */
export const MIN_PPS = 12
export const MAX_PPS = 320

export function msToX(ms: number, pps: number): number {
  return (ms / 1000) * pps
}

export function xToMs(x: number, pps: number): number {
  return (x / pps) * 1000
}

/** Позиция ползунка зума (0…100) — шкала логарифмическая. */
export function ppsToSlider(pps: number): number {
  const clamped = Math.min(MAX_PPS, Math.max(MIN_PPS, pps))
  return Math.round((Math.log(clamped / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100)
}

export function sliderToPps(value: number): number {
  const pct = Math.min(100, Math.max(0, value)) / 100
  return MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, pct)
}

export function zoomStep(pps: number, direction: 1 | -1): number {
  const next = direction > 0 ? pps * 1.35 : pps / 1.35
  return Math.min(MAX_PPS, Math.max(MIN_PPS, next))
}

/** Масштаб, при котором вся длительность помещается в ширину `widthPx` (fit). */
export function fitPps(durationMs: number, widthPx: number): number {
  if (durationMs <= 0 || widthPx <= 0) return MIN_PPS
  return Math.min(MAX_PPS, Math.max(MIN_PPS, (widthPx / durationMs) * 1000))
}

/**
 * Шаг подписей на линейке.
 *
 * Ряд фиксированный: первый шаг, при котором подписи не ближе 60 px. Так шкала
 * читается одинаково на любом зуме, а не прыгает произвольными числами.
 */
const TICK_STEPS_MS = [100, 250, 500, 1000, 2000, 5000, 10_000, 30_000, 60_000, 300_000, 600_000]

export function tickStepMs(pps: number): number {
  const minGapPx = 60
  for (const step of TICK_STEPS_MS) {
    if (msToX(step, pps) >= minGapPx) return step
  }
  return TICK_STEPS_MS[TICK_STEPS_MS.length - 1]
}

export type Tick = { ms: number; x: number }

export function buildTicks(durationMs: number, pps: number): Tick[] {
  const step = tickStepMs(pps)
  const out: Tick[] = []
  for (let ms = 0; ms <= durationMs; ms += step) {
    out.push({ ms, x: msToX(ms, pps) })
  }
  return out
}

/**
 * Прилипание к границам соседних реплик той же дорожки (§17.6).
 *
 * Допуск задан в пикселях, а не в миллисекундах: на любом зуме «рядом» должно
 * означать одно и то же расстояние на экране.
 */
export function snapMs(
  valueMs: number,
  edgesMs: number[],
  pps: number,
  tolerancePx = 8,
): number {
  const toleranceMs = xToMs(tolerancePx, pps)
  let best = valueMs
  let bestDelta = toleranceMs
  for (const edge of edgesMs) {
    const delta = Math.abs(edge - valueMs)
    if (delta < bestDelta) {
      best = edge
      bestDelta = delta
    }
  }
  return best
}

/** Границы всех реплик дорожки, кроме перетаскиваемой, — материал для прилипания. */
export function snapEdges(
  cues: { id: string; trackId: string; startMs: number; endMs: number }[],
  trackId: string,
  exceptCueId: string,
): number[] {
  const out: number[] = []
  for (const cue of cues) {
    if (cue.id === exceptCueId || cue.trackId !== trackId) continue
    out.push(cue.startMs, cue.endMs)
  }
  return out
}
