/**
 * Озвучка: операции над тейками и разметкой.
 *
 * Модель живёт в `dialog-doc.ts` вместе с остальным документом — это тот же
 * файл, и озвучка не отдельная сущность, а ещё один слой поверх реплик. Здесь
 * только операции, и они чистые: ни React, ни DOM, ни обращений к хранилищу.
 *
 * Три вещи, которые определяют всё остальное:
 *
 * 1. **Тейк привязан к языку.** У реплики может быть по своему набору тейков на
 *    испанский и на французский, и выбранный — один на язык.
 * 2. **Подстройка непортящая.** `offsetMs`, `rate`, `gainDb` — параметры; файл на
 *    диске не меняется. Отмена работает как на любой другой правке документа.
 * 3. **Начало важно, конец нет.** Тейк начинается в `startMs + offsetMs` и длится
 *    столько, сколько длится звук. Перекрытие тейков внутри дорожки — норма, и
 *    `rules.overlapWithinTrack` к ним не относится: оно про читаемость титров.
 */

import {
  clamp,
  compareCues,
  findCue,
  findTrack,
  translationOf,
  TAKE_GAIN_MAX,
  TAKE_GAIN_MIN,
  TAKE_RATE_MAX,
  TAKE_RATE_MIN,
  type Cue,
  type CueVoice,
  type DialogDoc,
  type Track,
  type TrackVoice,
  type VoiceTake,
} from "./dialog-doc"

const EMPTY_TRACK_VOICE: TrackVoice = {
  provider: null,
  voiceId: null,
  params: {},
  sample: null,
}

const EMPTY_CUE_VOICE: CueVoice = { markup: {}, takes: [] }

export function trackVoice(track: Track): TrackVoice {
  return track.voice ?? EMPTY_TRACK_VOICE
}

export function cueVoice(cue: Cue): CueVoice {
  return cue.voice ?? EMPTY_CUE_VOICE
}

/**
 * Пример голоса дорожки.
 *
 * По умолчанию — стем, отделённый на предыдущем шаге: это голос персонажа из
 * оригинала, и лучшего примера обычно нет. Человек может указать свой.
 */
export function voiceSample(track: Track): string | null {
  return trackVoice(track).sample ?? track.audio
}

/**
 * Что уйдёт в синтез.
 *
 * Разметка, если человек её завёл, иначе сам титр на этом языке. Дублировать
 * титр в разметку заранее не нужно: пустое поле означает «синтезируй как есть»,
 * и правка титра тогда сразу отражается на озвучке.
 */
export function synthText(doc: DialogDoc, cue: Cue, lang: string): string {
  const markup = cueVoice(cue).markup[lang]
  if (markup) return markup
  return lang === doc.languages.original ? cue.text : translationOf(cue, lang)
}

export function takesFor(cue: Cue, lang: string): VoiceTake[] {
  return cueVoice(cue).takes.filter((take) => take.lang === lang)
}

export function selectedTake(cue: Cue, lang: string): VoiceTake | null {
  const own = takesFor(cue, lang)
  return own.find((take) => take.selected) ?? own[own.length - 1] ?? null
}

export function takeStartMs(cue: Cue, take: VoiceTake): number {
  return Math.max(0, cue.startMs + take.offsetMs)
}

/** Конец тейка с учётом скорости: быстрее — короче. */
export function takeEndMs(cue: Cue, take: VoiceTake): number {
  return takeStartMs(cue, take) + Math.round(take.durationMs / take.rate)
}

/**
 * Тейк устарел: синтезировали одно, а в документе теперь другое.
 *
 * Сравнение по тексту, а не по времени правки: человек мог поправить титр и
 * вернуть как было, и объявлять тейк устаревшим в этом случае незачем.
 */
export function isTakeStale(doc: DialogDoc, cue: Cue, take: VoiceTake): boolean {
  if (!take.source) return false
  return take.source !== synthText(doc, cue, take.lang)
}

/** Номер для имени файла следующего тейка. Номера не переиспользуются. */
export function nextTakeNumber(cue: Cue): number {
  const used = cueVoice(cue).takes
    .map((take) => Number.parseInt(take.file.replace(/^.*-(\d+)\.[^.]+$/, "$1"), 10))
    .filter((n) => Number.isFinite(n))
  return (used.length > 0 ? Math.max(...used) : 0) + 1
}

/**
 * Путь файла тейка: `{NN}/voice/{cueId}-{n}.{ext}`.
 *
 * Внутри папки дорожки, а не в общей `voice/` рядом с ней: всё про персонажа
 * лежит в одном месте — сырьё титров, его стем и его озвучка. Работая с
 * персонажем, не надо ходить по двум деревьям, а удаление дорожки убирает одну
 * папку. Разделение «сырьё против сгенерированного» несёт сама вложенность:
 * `{NN}/*.srt` и `{NN}/audio.wav` не трогает никто, `{NN}/voice/**` — наше.
 */
export function takeFilePath(track: Track, cue: Cue, index: number, extension: string): string {
  return `${trackDir(track)}/voice/${cue.id}-${index}.${extension}`
}

/** Папка дорожки: номер с ведущим нулём. */
function trackDir(track: Track): string {
  return String(track.no).padStart(2, "0")
}

// ── операции над документом ──

export function setMarkup(
  doc: DialogDoc,
  cueId: string,
  lang: string,
  markup: string,
): DialogDoc {
  return patchVoice(doc, cueId, (voice) => ({
    ...voice,
    markup: { ...voice.markup, [lang]: markup },
  }))
}

/** «Вернуть титр»: убрать разметку, чтобы синтезировался сам титр. */
export function clearMarkup(doc: DialogDoc, cueId: string, lang: string): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue || !(lang in cueVoice(cue).markup)) return doc
  return patchVoice(doc, cueId, (voice) => {
    const markup = { ...voice.markup }
    delete markup[lang]
    return { ...voice, markup }
  })
}

/**
 * Добавить тейк. Он становится выбранным на своём языке, прежние остаются в
 * истории — «сгенерируй ещё раз» без потери предыдущего нужен почти всегда.
 */
export function addTake(doc: DialogDoc, cueId: string, take: VoiceTake): DialogDoc {
  return patchVoice(doc, cueId, (voice) => ({
    ...voice,
    takes: voice.takes
      .map((item) => (item.lang === take.lang ? { ...item, selected: false } : item))
      .concat([{ ...take, selected: true }]),
  }))
}

export function selectTake(doc: DialogDoc, cueId: string, takeId: string): DialogDoc {
  const cue = findCue(doc, cueId)
  const target = cue && cueVoice(cue).takes.find((take) => take.id === takeId)
  if (!target) return doc
  return patchVoice(doc, cueId, (voice) => ({
    ...voice,
    takes: voice.takes.map((take) =>
      take.lang === target.lang ? { ...take, selected: take.id === takeId } : take,
    ),
  }))
}

/**
 * Убрать тейк. Если убрали выбранный, выбранным становится самый свежий из
 * оставшихся на этом языке: язык не должен остаться без озвучки просто потому,
 * что удалили одну версию.
 */
export function removeTake(doc: DialogDoc, cueId: string, takeId: string): DialogDoc {
  const cue = findCue(doc, cueId)
  const target = cue && cueVoice(cue).takes.find((take) => take.id === takeId)
  if (!target) return doc
  return patchVoice(doc, cueId, (voice) => {
    const rest = voice.takes.filter((take) => take.id !== takeId)
    if (!target.selected) return { ...voice, takes: rest }
    const sameLang = rest.filter((take) => take.lang === target.lang)
    const latest = sameLang[sameLang.length - 1]
    return {
      ...voice,
      takes: rest.map((take) => ({ ...take, selected: take.id === latest?.id })),
    }
  })
}

/**
 * Убрать все тейки реплики на этом языке.
 *
 * Отдельной операцией, а не циклом по `removeTake`: тот на каждом шаге
 * перевыбирает оставшийся, и повторять эту работу столько раз, сколько было
 * версий, незачем. Тейки других языков не трогаются — они про другую работу.
 */
export function removeTakes(doc: DialogDoc, cueId: string, lang: string): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue || takesFor(cue, lang).length === 0) return doc
  return patchVoice(doc, cueId, (voice) => ({
    ...voice,
    takes: voice.takes.filter((take) => take.lang !== lang),
  }))
}

export type TakeAdjustment = { offsetMs?: number; rate?: number; gainDb?: number }

/** Подстройка тейка. Значения приводятся к границам здесь, а не в интерфейсе. */
export function adjustTake(
  doc: DialogDoc,
  cueId: string,
  takeId: string,
  patch: TakeAdjustment,
): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue) return doc
  return patchVoice(doc, cueId, (voice) => ({
    ...voice,
    takes: voice.takes.map((take) => {
      if (take.id !== takeId) return take
      return {
        ...take,
        // Начало не уезжает в минус: до нуля таймлинии ничего нет.
        offsetMs:
          patch.offsetMs == null
            ? take.offsetMs
            : Math.max(-cue.startMs, Math.round(patch.offsetMs)),
        rate:
          patch.rate == null ? take.rate : clamp(patch.rate, TAKE_RATE_MIN, TAKE_RATE_MAX),
        gainDb:
          patch.gainDb == null
            ? take.gainDb
            : clamp(patch.gainDb, TAKE_GAIN_MIN, TAKE_GAIN_MAX),
      }
    }),
  }))
}

/** Сбросить подстройку: тейк звучит как синтезировали. */
export function resetTake(doc: DialogDoc, cueId: string, takeId: string): DialogDoc {
  return patchVoice(doc, cueId, (voice) => ({
    ...voice,
    takes: voice.takes.map((take) =>
      take.id === takeId ? { ...take, offsetMs: 0, rate: 1, gainDb: 0 } : take,
    ),
  }))
}

/**
 * Куда разрешено подгонять тейк.
 *
 * Две независимые половины одной работы, и они нужны по отдельности: ужать
 * вылезшую за реплику озвучку надо почти всегда (иначе она лезет на следующую
 * реплику), а растягивать короткую — вопрос вкуса и материала.
 */
export type FitDirections = { shrink: boolean; stretch: boolean }

const FIT_BOTH: FitDirections = { shrink: true, stretch: true }

/**
 * «Вписать в реплику»: подобрать скорость так, чтобы тейк кончился вместе с
 * репликой.
 *
 * По кнопке — в обе стороны: «в размер» значит ровно в размер. Автоматическое
 * вписывание после генерации спрашивает разрешение у настроек, поэтому здесь и
 * `allow`.
 *
 * Скорость приводится к границам в `adjustTake`, поэтому очень короткий тейк
 * растянется не сильнее, чем вдвое, а не превратится в вой.
 */
export function fitTakeToCue(
  doc: DialogDoc,
  cueId: string,
  takeId: string,
  allow: FitDirections = FIT_BOTH,
): DialogDoc {
  const cue = findCue(doc, cueId)
  const take = cue && cueVoice(cue).takes.find((item) => item.id === takeId)
  if (!cue || !take || take.durationMs === 0) return doc
  const room = cue.endMs - takeStartMs(cue, take)
  if (room <= 0) return doc
  const rate = take.durationMs / room
  // Больше единицы — тейк длиннее реплики, значит его ускоряют; меньше —
  // замедляют. Разрешения спрашиваем по этому знаку, а не по конечной скорости
  // после приведения к границам.
  if (rate > 1 && !allow.shrink) return doc
  if (rate < 1 && !allow.stretch) return doc
  return adjustTake(doc, cueId, takeId, { rate })
}

export function setTrackVoice(
  doc: DialogDoc,
  trackId: string,
  patch: Partial<TrackVoice>,
): DialogDoc {
  if (!findTrack(doc, trackId)) return doc
  return {
    ...doc,
    tracks: doc.tracks.map((track) =>
      track.id === trackId ? { ...track, voice: { ...trackVoice(track), ...patch } } : track,
    ),
  }
}

/**
 * Убрать все невыбранные тейки.
 *
 * Файлы копятся быстро — по одному на каждую попытку, — а решать, что уже не
 * нужно, должен человек. Возвращает и пути удалённых файлов: их надо убрать из
 * папки, иначе останутся сироты, на которые никто не ссылается.
 */
export function pruneTakes(
  doc: DialogDoc,
  cueIds?: string[],
): { doc: DialogDoc; files: string[] } {
  const wanted = cueIds ? new Set(cueIds) : null
  const files: string[] = []
  const cues = doc.cues.map((cue) => {
    if (wanted && !wanted.has(cue.id)) return cue
    const voice = cueVoice(cue)
    if (voice.takes.length === 0) return cue
    const keep = new Set(
      [...new Set(voice.takes.map((take) => take.lang))]
        .map((lang) => selectedTake(cue, lang)?.id)
        .filter((id): id is string => Boolean(id)),
    )
    const dropped = voice.takes.filter((take) => !keep.has(take.id))
    if (dropped.length === 0) return cue
    for (const take of dropped) {
      files.push(take.file)
      if (take.peaks) files.push(take.peaks)
    }
    return {
      ...cue,
      rev: cue.rev + 1,
      voice: { ...voice, takes: voice.takes.filter((take) => keep.has(take.id)) },
    }
  })
  return { doc: { ...doc, cues: cues.sort(compareCues) }, files }
}

/** Все файлы тейка — их удаляют из папки вместе с ним. */
export function takeFiles(take: VoiceTake): string[] {
  return take.peaks ? [take.file, take.peaks] : [take.file]
}

/** Сколько реплик озвучено на этом языке — цифра для топбара и экспорта. */
export function voicedCount(doc: DialogDoc, lang: string): number {
  return doc.cues.filter((cue) => selectedTake(cue, lang) != null).length
}

function patchVoice(
  doc: DialogDoc,
  cueId: string,
  fn: (voice: CueVoice) => CueVoice,
): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue) return doc
  const next = fn(cueVoice(cue))
  return {
    ...doc,
    cues: doc.cues.map((item) =>
      // `rev` растёт: озвучка — такая же правка реплики, и слияние с чужой
      // версией должно видеть, что наша сторона новее.
      item.id === cueId ? { ...item, voice: next, rev: item.rev + 1 } : item,
    ),
  }
}
