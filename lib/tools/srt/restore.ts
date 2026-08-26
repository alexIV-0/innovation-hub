/**
 * Восстановление из сырья папки.
 *
 * Смысл в том, что исходные `{NN}/orig.srt` и `{NN}/{lang}.srt` инструмент
 * никогда не трогает: правки живут в `dialog.json`, а сырьё лежит рядом
 * неизменным. Значит на вопрос «что здесь было до моих правок» можно ответить
 * честно, а не «предыдущей версии не сохранилось».
 *
 * Чем это **не** является: это не отмена и не история версий. Отмена работает в
 * пределах сеанса и знает про каждый шаг; восстановление возвращает машинный
 * результат — то, с чего начинали, — и про промежуточные состояния не знает.
 *
 * Что связывает реплику с её блоком в файле — `origin`: `file` и `index`.
 * Реплики, созданные человеком (`origin.kind === "manual"`), сырья не имеют и
 * не трогаются: восстанавливать их не из чего, а удалять при «сбросить всё»
 * было бы подменой смысла — человек просил вернуть машинное, а не вычистить своё.
 */

import {
  compareCues,
  findTrack,
  type Cue,
  type DialogDoc,
  type Track,
} from "./dialog-doc"
import { srtByIndex, type SrtCue } from "./srt-parse"

export type RestoreScope = {
  trackIds: string[]
  /** Что восстанавливать: `null` — оригинал, иначе код языка перевода. */
  langs: (string | null)[]
  /** Текст реплик. */
  text: boolean
  /** Тайминги. Берутся только из оригинального файла: он тут авторитет. */
  timing: boolean
  /** Вернуть реплику на дорожку, из файла которой она пришла. */
  track: boolean
  /** Вернуть реплики, которых в документе больше нет. */
  deleted: boolean
  /** Вернуть машинные имена дорожек. */
  names: boolean
}

export type RestoreReport = {
  doc: DialogDoc
  /** Сколько реплик изменилось. */
  changed: number
  /** Сколько вернулось из удалённых. */
  restored: number
  /** Сколько дорожек переименовано обратно. */
  renamed: number
  /** Реплики, для которых не нашлось блока в сырье. */
  unmatched: number
  /** Реплики, у которых сырья нет вовсе: их создал человек. */
  manual: number
}

/** Путь к сырью: оригинал берётся из `origin.file`, перевод — по раскладке папки. */
export function sourcePathFor(
  doc: DialogDoc,
  cue: Cue,
  lang: string | null,
): string | null {
  const track = findTrack(doc, cue.trackId)
  if (!track) return null
  if (lang === null) return cue.origin?.file ?? `${trackDir(track)}/orig.srt`
  return `${trackDir(track)}/${lang}.srt`
}

/** Все пути сырья, которые понадобятся для такого восстановления. */
export function sourcePathsFor(doc: DialogDoc, scope: RestoreScope): string[] {
  const wanted = new Set(scope.trackIds)
  const paths = new Set<string>()
  for (const track of doc.tracks) {
    if (!wanted.has(track.id)) continue
    for (const lang of scope.langs) {
      if (lang === null) {
        // Оригинал: у каждой реплики свой `origin.file`, и они могут различаться.
        const own = doc.cues.filter((cue) => cue.trackId === track.id && cue.origin?.file)
        if (own.length === 0) paths.add(`${trackDir(track)}/orig.srt`)
        for (const cue of own) paths.add(cue.origin!.file!)
      } else {
        paths.add(`${trackDir(track)}/${lang}.srt`)
      }
    }
  }
  return [...paths]
}

/**
 * Вернуть машинный результат в выбранных пределах.
 *
 * `sources` — разобранное сырьё по путям: то, что вызывающий уже прочитал из
 * папки. Функция чистая и в хранилище не ходит.
 */
export function restoreFromSrt(
  doc: DialogDoc,
  sources: Map<string, SrtCue[]>,
  scope: RestoreScope,
): RestoreReport {
  const wanted = new Set(scope.trackIds)
  const indexed = new Map<string, Map<number, SrtCue>>()
  const blocksOf = (path: string) => {
    if (!indexed.has(path)) indexed.set(path, srtByIndex(sources.get(path) ?? []))
    return indexed.get(path)!
  }

  let changed = 0
  let unmatched = 0
  let manual = 0

  const cues = doc.cues.map((cue) => {
    if (!wanted.has(cue.trackId)) return cue
    if (cue.origin?.kind !== "auto" || cue.origin.index == null) {
      manual += 1
      return cue
    }

    let next = cue
    const patch: Partial<Cue> = {}

    if (scope.timing || scope.text) {
      const path = sourcePathFor(doc, cue, null)
      const block = path ? blocksOf(path).get(cue.origin.index) : undefined
      if (!block) unmatched += 1
      else {
        if (scope.timing && (block.startMs !== cue.startMs || block.endMs !== cue.endMs)) {
          patch.startMs = block.startMs
          patch.endMs = block.endMs
        }
        if (scope.text && scope.langs.includes(null) && block.text !== cue.text) {
          patch.text = block.text
        }
      }
    }

    if (scope.text) {
      const tr: Cue["tr"] = { ...cue.tr }
      let touched = false
      for (const lang of scope.langs) {
        if (lang === null) continue
        const path = sourcePathFor(doc, cue, lang)
        const block = path ? blocksOf(path).get(cue.origin.index) : undefined
        if (!block) continue
        if ((tr[lang]?.text ?? "") === block.text) continue
        tr[lang] = { text: block.text, status: "draft" }
        touched = true
      }
      if (touched) patch.tr = tr
    }

    if (scope.track && cue.movedFrom && findTrack(doc, cue.movedFrom)) {
      patch.trackId = cue.movedFrom
      patch.movedFrom = undefined
    }

    if (Object.keys(patch).length === 0) return cue
    changed += 1
    // `rev` растёт: восстановление — такая же правка, и слияние с чужой версией
    // должно видеть, что наша сторона новее.
    next = { ...cue, ...patch, rev: cue.rev + 1, status: "auto" }
    if (patch.movedFrom === undefined && "movedFrom" in patch) delete next.movedFrom
    return next
  })

  // Имена дорожек: их нет в сырье папки, поэтому единственный источник —
  // `tracks[].origin.name`, куда обработка записала своё имя.
  let renamed = 0
  const tracks = doc.tracks.map((track) => {
    if (!scope.names || !wanted.has(track.id)) return track
    const original = track.origin?.name
    if (!original || original === track.name) return track
    renamed += 1
    return { ...track, name: original }
  })

  let restored = 0
  if (scope.deleted) {
    const known = new Set<string>()
    for (const cue of cues) {
      if (cue.origin?.kind === "auto" && cue.origin.file && cue.origin.index != null) {
        known.add(`${cue.origin.file}#${cue.origin.index}`)
      }
    }
    for (const track of doc.tracks) {
      if (!wanted.has(track.id)) continue
      const path = `${trackDir(track)}/orig.srt`
      for (const block of sources.get(path) ?? []) {
        const key = `${path}#${block.index}`
        if (known.has(key)) continue
        known.add(key)
        cues.push(recreate(track, block, path, scope, sources))
        restored += 1
      }
    }
  }

  return {
    changed,
    restored,
    renamed,
    unmatched,
    manual,
    doc: { ...doc, tracks, cues: cues.sort(compareCues) },
  }
}

/**
 * Заново заведённая реплика получает новый `id`.
 *
 * Прежний остаётся в `removed` и больше не воскресает — так и надо: удаление
 * конкретной реплики зафиксировано, а это новая запись с тем же содержимым.
 */
function recreate(
  track: Track,
  block: SrtCue,
  path: string,
  scope: RestoreScope,
  sources: Map<string, SrtCue[]>,
): Cue {
  const tr: Cue["tr"] = {}
  for (const lang of scope.langs) {
    if (lang === null) continue
    const translated = srtByIndex(sources.get(`${trackDir(track)}/${lang}.srt`) ?? []).get(
      block.index,
    )
    if (translated) tr[lang] = { text: translated.text, status: "draft" }
  }
  return {
    id: `c_r${block.index}${track.id}`,
    trackId: track.id,
    startMs: block.startMs,
    endMs: block.endMs,
    text: block.text,
    tr,
    status: "auto",
    rev: 1,
    origin: { kind: "auto", file: path, index: block.index },
    note: "",
  }
}

/** Папка дорожки: номер с ведущим нулём (§2.1 раскладки папки задачи). */
function trackDir(track: Track): string {
  return String(track.no).padStart(2, "0")
}

/** Всё и полностью — то, с чего начиналась задача. */
export function fullRestoreScope(doc: DialogDoc): RestoreScope {
  return {
    trackIds: doc.tracks.map((track) => track.id),
    langs: [null, ...doc.languages.targets],
    text: true,
    timing: true,
    track: true,
    deleted: true,
    names: true,
  }
}
