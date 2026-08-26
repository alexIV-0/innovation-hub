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

/**
 * Цвет дорожки с прозрачностью.
 *
 * Палитра дорожек — шестнадцатеричные строки (`#5b9be0`), а фон клипа нужен
 * полупрозрачным. Принимает и то, что уже с прозрачностью: тогда возвращает как
 * есть, чтобы вызов не приходилось оборачивать проверкой.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.trim()
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex
  const value = parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 0xff
  const g = (value >> 8) & 0xff
  const b = value & 0xff
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
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
