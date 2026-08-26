/**
 * WAV, 16 бит, моно.
 *
 * Свой кодировщик, а не библиотека: RIFF-заголовок — это сорок четыре байта по
 * таблице, и зависимость ради них несоразмерна. Браузер такой файл играет, а
 * `Range`-запросы к нему работают, потому что заголовок в начале.
 *
 * Отдельным файлом, а не внутри заглушки синтеза: WAV пишут двое — заглушка и
 * экспорт, — и когда заглушку заменит настоящий провайдер, кодировщик останется
 * нужен.
 */

/**
 * WAV, 16 бит, моно.
 *
 * Свой кодировщик, а не библиотека: RIFF-заголовок — это сорок четыре байта по
 * таблице, и зависимость ради них несоразмерна. Браузер такой файл играет, и
 * `Range`-запросы к нему работают, потому что заголовок в начале.
 */
export function encodeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const out = new Uint8Array(44 + dataSize)
  const view = new DataView(out.buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, "WAVE")
  ascii(12, "fmt ")
  view.setUint32(16, 16, true) // длина блока fmt
  view.setUint16(20, 1, true) // PCM без сжатия
  view.setUint16(22, 1, true) // моно
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // байт в секунду
  view.setUint16(32, bytesPerSample, true) // байт на кадр
  view.setUint16(34, 8 * bytesPerSample, true) // бит на сэмпл
  ascii(36, "data")
  view.setUint32(40, dataSize, true)
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(44 + i * 2, samples[i], true)
  }
  return out
}


/**
 * Дорожка Web Audio → 16 бит.
 *
 * Значения за пределами −1…1 срезаются: сложение нескольких тейков может выйти
 * за потолок, и без ограничения это слышно как треск.
 */
export function toInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    out[i] = Math.round(value * 32767)
  }
  return out
}

export const WAV_MIME = "audio/wav"
