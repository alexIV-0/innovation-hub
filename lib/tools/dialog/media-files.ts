/**
 * Видео задачи в папке — выбор по имени и типу.
 *
 * Чистая часть подбора: имя исходника контрактом не закреплено, и `media.video`
 * в документе может отставать или отсутствовать. Тогда видео берётся из корня
 * папки задачи, а решает — этот модуль. Здесь нет ни React, ни обращений к
 * хранилищу: те же правила понадобятся локальному редактору в программе.
 */

/**
 * Расширение — не украшение к типу, а замена ему: тип проставляется при заливке
 * через браузер, а файл, попавший в хранилище другим путём, лежит с пустым
 * `contentType`, и по одному типу такое видео было бы не найти.
 */
const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|avi|mxf)$/i

/** Слова, которыми обработка называет облегчённую копию для просмотра. */
const PROXY_TOKENS = new Set(["proxy", "preview", "прокси", "превью"])

export type VideoCandidate = { name: string; contentType?: string | null }

/** Похож ли файл на видео. */
export function looksLikeVideo(file: VideoCandidate): boolean {
  if (file.contentType?.toLowerCase().startsWith("video/")) return true
  return VIDEO_EXTENSION.test(file.name)
}

/** Имя без расширения, разобранное на куски: `clip_042-proxy.mp4` → clip, 042, proxy. */
function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/** Назван ли файл прокси — отдельным словом в имени, а не куском другого слова. */
export function isProxyName(name: string): boolean {
  return tokensOf(name).some((token) => PROXY_TOKENS.has(token))
}

/**
 * Какое видео из папки играть.
 *
 * Порядок предпочтений:
 *
 * 1. **прокси** — он для того и сделан: H.264, частые ключевые кадры, лёгкий.
 *    Мастер рядом может оказаться ProRes или HEVC, которые браузер не покажет
 *    вовсе, так что это не оптимизация, а условие того, что кадр вообще будет;
 * 2. **`mp4`** — его ждём от обработки и играют его все браузеры;
 * 3. остальное — лучше показать хоть что-то, чем пустую рамку.
 *
 * Внутри группы — по имени: выбор не должен зависеть от порядка строк каталога
 * и меняться сам по себе между открытиями задачи.
 */
export function pickVideoName(files: VideoCandidate[]): string | null {
  const rank = (file: VideoCandidate) =>
    isProxyName(file.name) ? 0 : /\.mp4$/i.test(file.name) ? 1 : 2
  return (
    files
      .filter(looksLikeVideo)
      .slice()
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))[0]?.name ?? null
  )
}

/**
 * Имя файла волны рядом с исходником: `proxy.mp4` → `proxy.peaks.json`.
 *
 * Соглашение, а не запись в документе: волну считает сам инструмент, и класть
 * её по предсказуемому имени дешевле, чем править ради этого общий документ.
 * `media.peaks` из документа при этом старше — если обработка волну положила и
 * назвала, берётся она.
 *
 * Предел соглашения: `clip.mp4` и `clip.wav` в одной папке дадут одно имя
 * волны. Материал в двух контейнерах рядом — случай, которого в папке задачи не
 * бывает, а различать их полным именем значило бы разойтись с именами, которые
 * кладёт обработка (`audio.wav` → `audio.peaks.json`).
 */
export function peaksNameFor(name: string): string {
  return `${name.replace(/\.[^.]+$/, "")}.peaks.json`
}
