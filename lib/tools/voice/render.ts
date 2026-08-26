"use client"

/**
 * Сведение озвучки в один звук.
 *
 * Единственное место инструмента, которому нужен браузер: Web Audio декодирует
 * файлы, применяет громкость и скорость и складывает тейки по своим местам.
 * `ffmpeg` для этого не нужен — а его у сайта и нет.
 *
 * Что здесь обязательно применяется: `offsetMs` (где тейк начинается),
 * `gainDb` (громкость) и `rate` (скорость). Файл без них не соответствовал бы
 * тому, что человек слышал в превью, и следующий шаг получил бы не то, что
 * принимали.
 *
 * Одна честная оговорка про скорость: `playbackRate` у Web Audio —
 * пересэмплирование, оно меняет высоту голоса. В превью браузер высоту сохраняет
 * (`preservesPitch` у `<audio>` включён), поэтому ускоренный тейк в файле звучит
 * выше, чем в редакторе. Интерфейс об этом предупреждает; окончательно вопрос
 * закрывается растяжением по времени или рендером через `ffmpeg`
 * ([TOOLS_VOICEOVER_PLAN.md §8.3](../../../docs/TOOLS_VOICEOVER_PLAN.md)).
 */

import { toInt16 } from "./wav"

export type RenderSource = {
  /** Подписанная ссылка на файл тейка. */
  url: string
  /** Где тейк начинается на таймлинии. */
  startMs: number
  rate: number
  gainDb: number
}

export type RenderResult = {
  samples: Int16Array
  sampleRate: number
}

/** Один канал: озвучка — речь, стерео ей ничего не даёт, а файл вдвое больше. */
const CHANNELS = 1
/** Достаточно для речи и в полтора раза меньше, чем 48 кГц. */
export const RENDER_SAMPLE_RATE = 32_000

export async function renderMix(
  sources: RenderSource[],
  options: { durationMs: number; sampleRate?: number; onProgress?: (done: number) => void },
): Promise<RenderResult> {
  const sampleRate = options.sampleRate ?? RENDER_SAMPLE_RATE
  // Хвост в секунду: последний тейк может кончиться позже материала, и обрезать
  // его на полуслове хуже, чем отдать файл чуть длиннее.
  const frames = Math.max(1, Math.round(((options.durationMs + 1000) / 1000) * sampleRate))

  const OfflineCtor =
    typeof OfflineAudioContext !== "undefined"
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
  if (!OfflineCtor) throw new Error("Web Audio is not available in this browser.")

  const ctx = new OfflineCtor(CHANNELS, frames, sampleRate)
  let done = 0

  for (const source of sources) {
    const response = await fetch(source.url)
    if (!response.ok) throw new Error(`Failed to read a take: ${response.status}`)
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer())

    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = source.rate

    const gain = ctx.createGain()
    gain.gain.value = Math.pow(10, source.gainDb / 20)

    node.connect(gain).connect(ctx.destination)
    node.start(Math.max(0, source.startMs) / 1000)

    done += 1
    options.onProgress?.(done)
  }

  const rendered = await ctx.startRendering()
  return { samples: toInt16(rendered.getChannelData(0)), sampleRate }
}
