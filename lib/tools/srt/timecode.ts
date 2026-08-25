/**
 * Таймкоды документа. Чистые функции: переносятся в программу как есть (§20.1).
 *
 * Внутри всё в миллисекундах — так лежит в `dialog.json`. Секунд с плавающей
 * точкой в модели нет намеренно: на них тайминги «уплывают» после десятка
 * правок, а SRT всё равно пишется целыми миллисекундами.
 */

/** `mm:ss,mmm`, а при длительности от часа — `h:mm:ss,mmm`. */
export function formatTc(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const msPart = total % 1000
  const sec = Math.floor(total / 1000) % 60
  const min = Math.floor(total / 60_000) % 60
  const hour = Math.floor(total / 3_600_000)
  const tail = `${pad(min, hour > 0 ? 2 : 2)}:${pad(sec, 2)},${pad(msPart, 3)}`
  return hour > 0 ? `${hour}:${tail}` : tail
}

/** `mm:ss` — подписи на линейке таймлинии, где миллисекунды только мешают. */
export function formatTcShort(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const sec = Math.floor(total / 1000) % 60
  const min = Math.floor(total / 60_000) % 60
  const hour = Math.floor(total / 3_600_000)
  return hour > 0
    ? `${hour}:${pad(min, 2)}:${pad(sec, 2)}`
    : `${pad(min, 2)}:${pad(sec, 2)}`
}

/** `hh:mm:ss,mmm` — формат SRT, всегда с часами и всегда двумя цифрами. */
export function formatSrtTc(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  return (
    `${pad(Math.floor(total / 3_600_000), 2)}:` +
    `${pad(Math.floor(total / 60_000) % 60, 2)}:` +
    `${pad(Math.floor(total / 1000) % 60, 2)},` +
    `${pad(total % 1000, 3)}`
  )
}

/**
 * Разбор того, что человек напечатал в поле тайминга.
 *
 * Принимаем и `hh:mm:ss,mmm`, и `mm:ss,mmm`, и `ss,mmm`, точку наравне с
 * запятой. `null` — не разобралось; вызывающий обязан оставить прежнее
 * значение, а не подставлять ноль.
 */
export function parseTc(text: string): number | null {
  const raw = String(text).trim().replace(",", ".")
  const m = raw.match(/^(?:(\d+):)?(?:(\d+):)?(\d+)(?:\.(\d{1,3}))?$/)
  if (!m) return null
  const [, a, b, c, frac] = m
  // Разряды считаем справа налево: последнее число — всегда секунды.
  const sec = Number(c)
  const min = b != null ? Number(b) : a != null ? Number(a) : 0
  const hour = b != null && a != null ? Number(a) : 0
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0
  return hour * 3_600_000 + min * 60_000 + sec * 1000 + ms
}

/** Длительность строкой: `2.5s` — как в списке реплик. */
export function formatDuration(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, "0")
}
