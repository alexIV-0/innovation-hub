/**
 * Счёт волны из звука — в браузере.
 *
 * Второе место инструмента, которому нужен браузер (первое —
 * `lib/tools/voice/render.ts`): Web Audio декодирует файл, а дальше работает
 * обычный `buildPeaks`. `ffmpeg` не нужен, и это важно — его у сайта нет, и
 * ради волны не приходится ни писать ноду в графе, ни ставить кодеки на сервер.
 *
 * Декодируем в моно на 8 кГц. При пятидесяти парах в секунду это 160 сэмплов на
 * столбик — точности с запасом, а память и время падают в разы: десятиминутный
 * ролик в исходных 48 кГц стерео это четверть гигабайта во float32, и считать
 * такое в фоне, пока человек правит титры, нельзя.
 */

import { buildPeaks } from "./peaks"

export type PeaksFile = ReturnType<typeof buildPeaks>

/** Частота декодирования: ниже — уже слышно на глаз, выше — лишняя память. */
const DECODE_RATE = 8000

function offlineCtor(): typeof OfflineAudioContext | null {
  if (typeof OfflineAudioContext !== "undefined") return OfflineAudioContext
  return (
    (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext ?? null
  )
}

/**
 * Волна файла по ссылке. `null` — не смогли, и это не авария.
 *
 * Не смочь можно законно: браузер не разбирает контейнер (в mp4 звук лежит
 * рядом с видео, и не всякий браузер достанет его через `decodeAudioData`),
 * файл не скачался, звука в нём нет вовсе. Волна — украшение таймлинии, а не
 * условие работы: без неё правятся и текст, и тайминги.
 */
export async function computePeaksFromUrl(
  url: string,
  pps = 50,
): Promise<PeaksFile | null> {
  const Ctor = offlineCtor()
  if (!Ctor) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const bytes = await response.arrayBuffer()
    // Контекст нужен только ради декодирования, поэтому он длиной в один кадр:
    // частоту он задаёт, а считать в нём ничего не будем.
    const ctx = new Ctor(1, 1, DECODE_RATE)
    const buffer = await ctx.decodeAudioData(bytes)
    if (buffer.length === 0) return null
    return buildPeaks(buffer.getChannelData(0), buffer.sampleRate, pps)
  } catch {
    return null
  }
}
