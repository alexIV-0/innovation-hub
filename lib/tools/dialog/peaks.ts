/**
 * Волна для таймлинии: разбор `*.peaks.json` от ноды `audioPeaks` (§V.4).
 *
 * Файл: `{ version, pps, bits, dur, data }`, где `data` — base64 пар min/max
 * (int8 или int16) с шагом `1000/pps` мс. Разбор чистый, без DOM: отрисовкой
 * занимается вызывающий, здесь только числа (§20.1).
 */

export type Peaks = {
  /** Пар в секунду — шаг сетки исходных данных. */
  pps: number
  durationMs: number
  /** Значения −1…1, попарно: min, max. */
  values: Float32Array
}

/**
 * Собрать файл пиков из готовых сэмплов.
 *
 * Нужно тому, кто создал звук сам: волну к нему больше посчитать некому, а
 * `ffmpeg` для этого не требуется — сэмплы уже на руках. Формат тот же, что у
 * ноды `audioPeaks`, чтобы файлы были неотличимы по происхождению.
 */
export function buildPeaks(
  samples: Float32Array | Int16Array,
  sampleRate: number,
  pps = 50,
): { version: 1; pps: number; bits: 8; dur: number; data: string } {
  const scale = samples instanceof Int16Array ? 32768 : 1
  const window = Math.max(1, Math.round(sampleRate / pps))
  const pairs = Math.ceil(samples.length / window)
  const bytes = new Int8Array(pairs * 2)
  for (let i = 0; i < pairs; i += 1) {
    let lo = 0
    let hi = 0
    const from = i * window
    const to = Math.min(from + window, samples.length)
    for (let j = from; j < to; j += 1) {
      const value = samples[j] / scale
      if (value < lo) lo = value
      if (value > hi) hi = value
    }
    // −128 не используем: диапазон должен быть симметричным, иначе тихий звук
    // рисуется чуть ниже нуля даже при полной тишине.
    bytes[i * 2] = Math.max(-127, Math.round(lo * 127))
    bytes[i * 2 + 1] = Math.min(127, Math.round(hi * 127))
  }
  return {
    version: 1,
    pps,
    bits: 8,
    dur: Number((samples.length / sampleRate).toFixed(3)),
    data: toBase64(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
  }
}

/** Base64 и на сервере, и в браузере: `Buffer` есть только в первом. */
function toBase64(bytes: Uint8Array): string {
  const maybeBuffer = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(e: string): string } } })
    .Buffer
  if (maybeBuffer) return maybeBuffer.from(bytes).toString("base64")
  let binary = ""
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function parsePeaks(input: unknown): Peaks | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const pps = typeof raw.pps === "number" ? raw.pps : 0
  const data = typeof raw.data === "string" ? raw.data : ""
  if (pps <= 0 || !data) return null
  const bits = raw.bits === 16 ? 16 : 8

  let bytes: Uint8Array
  try {
    const binary = atob(data)
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  } catch {
    return null
  }

  const scale = bits === 16 ? 32768 : 128
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = bits === 16 ? Math.floor(bytes.length / 2) : bytes.length
  const values = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    values[i] = (bits === 16 ? view.getInt16(i * 2, true) : view.getInt8(i)) / scale
  }

  const dur = typeof raw.dur === "number" ? raw.dur : count / 2 / pps
  return { pps, durationMs: Math.round(dur * 1000), values }
}

/**
 * Столбики волны под ширину в пикселях.
 *
 * На каждый пиксель берём все пары, попавшие в его диапазон, и возвращаем
 * размах от min до max. Когда пар на пиксель меньше одной — интерполяции нет,
 * повторяем последнюю: рисовать гладкую кривую, которой в данных нет, честнее
 * не стало бы (§17.3).
 */
export function peakBars(
  peaks: Peaks,
  widthPx: number,
  pxPerMs: number,
  /** Смещение окна от начала полотна: рисуем только видимый кусок. */
  offsetPx = 0,
): { min: Float32Array; max: Float32Array } {
  const width = Math.max(0, Math.floor(widthPx))
  const min = new Float32Array(width)
  const max = new Float32Array(width)
  const pairs = Math.floor(peaks.values.length / 2)
  if (width === 0 || pairs === 0) return { min, max }

  const msPerPair = 1000 / peaks.pps
  for (let x = 0; x < width; x += 1) {
    const fromMs = (offsetPx + x) / pxPerMs
    const toMs = (offsetPx + x + 1) / pxPerMs
    const first = Math.floor(fromMs / msPerPair)
    const last = Math.min(pairs - 1, Math.max(first, Math.ceil(toMs / msPerPair) - 1))
    if (first >= pairs) break
    if (first < 0) continue
    let lo = 0
    let hi = 0
    for (let i = first; i <= last; i += 1) {
      const a = peaks.values[i * 2]
      const b = peaks.values[i * 2 + 1]
      if (a < lo) lo = a
      if (b > hi) hi = b
    }
    min[x] = lo
    max[x] = hi
  }
  return { min, max }
}
