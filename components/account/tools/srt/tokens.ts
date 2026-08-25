"use client"

/**
 * Токены `ws-*` для canvas.
 *
 * Рисующий код не знает про Tailwind и не должен: он получает цвета строками и
 * тем самым переносится в программу без правок (§20.3, правило 2). Здесь —
 * единственное место, где значение токена достают из CSS.
 */
export function readToken(element: Element | null, name: string, alpha = 1): string {
  if (!element) return "transparent"
  const raw = getComputedStyle(element).getPropertyValue(name).trim()
  if (!raw) return "transparent"
  return alpha >= 1 ? `hsl(${raw})` : `hsl(${raw} / ${alpha})`
}

export type TimelinePalette = {
  tick: string
  tickLabel: string
  wave: string
  playhead: string
}

export function readTimelinePalette(element: Element | null): TimelinePalette {
  return {
    tick: readToken(element, "--ws-text-5", 0.55),
    tickLabel: readToken(element, "--ws-text-4"),
    wave: readToken(element, "--ws-accent"),
    playhead: readToken(element, "--ws-playhead"),
  }
}
