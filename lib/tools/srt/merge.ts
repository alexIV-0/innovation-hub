/**
 * Слияние двух версий документа (§8 [DIALOG_FORMAT.md](../../../docs/DIALOG_FORMAT.md)).
 *
 * Нужно потому, что папка задачи — общая: тот же документ могут править из другой
 * вкладки, с другой машины или дописать повторным прогоном обработки. Побеждать
 * «последнему записавшему» нельзя — это молча стирает чужую работу.
 *
 * Правила разрешения:
 *
 * - реплика есть только у одной стороны → берётся как есть, если её нет в `removed` у другой;
 * - реплика есть у обеих → выигрывает та, у которой больше `rev`;
 * - `rev` равны, а содержимое разное → берётся наша (мы правим прямо сейчас), и
 *   выжившая помечается `status: "conflict"` — человек должен увидеть, что чужая
 *   правка не пропала бесследно, а была перекрыта;
 * - дорожки — объединение по `id`, имя и цвет из документа с большей `revision`;
 * - `removed` — объединение, и всё, что в нём, из реплик выбрасывается;
 * - `revision` результата — `max(наш, их) + 1`.
 *
 * Чистые функции: файл целиком переезжает в локальный редактор программы, где
 * тот же алгоритм применяется по `mtime` + `size` вместо ETag (§20.1 плана).
 */

import { compareCues, type Cue, type DialogDoc, type Track } from "./dialog-doc"

export type MergeReport = {
  doc: DialogDoc
  /** Сколько реплик пришло со стороны сервера. */
  taken: number
  /** Сколько реплик перекрыто нашей версией и помечено конфликтом. */
  conflicts: number
}

export function mergeDialogDocs(mine: DialogDoc, theirs: DialogDoc): MergeReport {
  const removed = mergeRemoved(mine.removed, theirs.removed)
  const removedIds = new Set(removed.map((item) => item.id))

  const newer = theirs.revision > mine.revision ? theirs : mine
  const tracks = mergeTracks(mine.tracks, theirs.tracks, newer)

  const mineById = new Map(mine.cues.map((cue) => [cue.id, cue]))
  const theirsById = new Map(theirs.cues.map((cue) => [cue.id, cue]))
  const cues: Cue[] = []
  let taken = 0
  let conflicts = 0

  for (const id of new Set([...mineById.keys(), ...theirsById.keys()])) {
    if (removedIds.has(id)) continue
    const ours = mineById.get(id)
    const theirsCue = theirsById.get(id)
    if (!ours && theirsCue) {
      cues.push(theirsCue)
      taken += 1
      continue
    }
    if (ours && !theirsCue) {
      cues.push(ours)
      continue
    }
    if (!ours || !theirsCue) continue
    if (theirsCue.rev > ours.rev) {
      cues.push(theirsCue)
      taken += 1
    } else if (ours.rev > theirsCue.rev) {
      cues.push(ours)
    } else if (sameCue(ours, theirsCue)) {
      cues.push(ours)
    } else {
      cues.push({ ...ours, status: "conflict" })
      conflicts += 1
    }
  }

  // Реплика могла уехать на дорожку, которой в объединении нет: так бывает,
  // когда одна сторона удалила дорожку, а другая перенесла в неё реплику.
  // Оставлять ссылку в пустоту нельзя — документ станет невалидным.
  const known = new Set(tracks.map((track) => track.id))
  const fallback = tracks[0]?.id
  const fixed = cues
    .map((cue) => (known.has(cue.trackId) || !fallback ? cue : { ...cue, trackId: fallback }))
    .filter((cue) => known.has(cue.trackId))
    .sort(compareCues)

  return {
    taken,
    conflicts,
    doc: {
      ...newer,
      revision: Math.max(mine.revision, theirs.revision) + 1,
      // Языки — объединение с сохранением порядка: он задаёт порядок колонок.
      languages: {
        ...newer.languages,
        original: newer.languages.original,
        targets: unique([...theirs.languages.targets, ...mine.languages.targets]),
      },
      tracks,
      cues: fixed,
      removed,
    },
  }
}

/** Совпадают ли реплики по всему, что видит человек. */
function sameCue(a: Cue, b: Cue): boolean {
  if (
    a.trackId !== b.trackId ||
    a.startMs !== b.startMs ||
    a.endMs !== b.endMs ||
    a.text !== b.text ||
    (a.note ?? "") !== (b.note ?? "")
  ) {
    return false
  }
  const langs = new Set([...Object.keys(a.tr), ...Object.keys(b.tr)])
  for (const lang of langs) {
    if ((a.tr[lang]?.text ?? "") !== (b.tr[lang]?.text ?? "")) return false
  }
  return true
}

function mergeTracks(mine: Track[], theirs: Track[], newer: DialogDoc): Track[] {
  const byId = new Map<string, Track>()
  // Сначала сторона с меньшей ревизией, потом с большей: она и перекроет
  // расхождения в имени и цвете.
  const older = newer.tracks === mine ? theirs : mine
  for (const track of older) byId.set(track.id, track)
  for (const track of newer.tracks) byId.set(track.id, track)
  return [...byId.values()].sort((a, b) => a.no - b.no)
}

function mergeRemoved(
  mine: { id: string; at: string }[],
  theirs: { id: string; at: string }[],
): { id: string; at: string }[] {
  const byId = new Map<string, { id: string; at: string }>()
  for (const item of [...theirs, ...mine]) {
    const existing = byId.get(item.id)
    // Оставляем более раннюю отметку: удалили тогда, когда удалили в первый раз.
    if (!existing || item.at < existing.at) byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
