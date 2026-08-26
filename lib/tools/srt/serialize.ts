/**
 * Запись документа `dialog.json`.
 *
 * Форма файла — часть контракта, а не вкус: две реализации должны на одном и том
 * же документе выдать одни и те же байты, иначе любой diff превращается в кашу,
 * а проверка «открыл → сохранил → файл тот же» перестаёт что-либо значить
 * ([DIALOG_FORMAT.md §2.4, §10](../../../docs/DIALOG_FORMAT.md)).
 *
 * Отсюда три правила записи:
 *
 * 1. **порядок ключей канонический** — тот же, что в описании формата;
 * 2. **пустые необязательные поля не пишутся** — `null` и `""` опускаются, кроме
 *    тех, где отсутствие и пустота значат разное (`languages.targets`);
 * 3. **неизвестные поля возвращаются на место**, в конец своего объекта.
 *
 * Отступ — два пробела, в конце файла перевод строки: ровно то, что проверяет
 * `scripts/check-dialog-doc.mjs`.
 */

import { compareCues, type Cue, type DialogDoc, type Track } from "./dialog-doc"

export function serializeDialogDoc(doc: DialogDoc): string {
  return `${JSON.stringify(canonical(doc), null, 2)}\n`
}

/** Документ в каноническом виде — то, что пойдёт в `JSON.stringify`. */
export function canonical(doc: DialogDoc): Record<string, unknown> {
  return compact({
    format: "dialogDoc",
    version: doc.version,
    id: doc.id,
    revision: doc.revision,
    updatedAt: doc.updatedAt,
    updatedBy: doc.updatedBy || undefined,
    producer: doc.producer || undefined,
    media: compact({
      video: doc.media.video ?? undefined,
      mix: doc.media.mix ?? undefined,
      peaks: doc.media.peaks ?? undefined,
      durationMs: doc.media.durationMs,
      fps: doc.media.fps ?? undefined,
      ...(doc.media.extra ?? {}),
    }),
    languages: compact({
      original: doc.languages.original,
      // Пустой список — не то же, что отсутствие: он говорит «переводов нет»,
      // и колонка перевода в редакторе на это опирается.
      targets: doc.languages.targets,
      ...(doc.languages.extra ?? {}),
    }),
    rules: compact({
      maxCps: doc.rules.maxCps,
      maxTranslationRatio: doc.rules.maxTranslationRatio,
      minDurationMs: doc.rules.minDurationMs,
      minGapMs: doc.rules.minGapMs,
      overlapWithinTrack: doc.rules.overlapWithinTrack,
      ...(doc.rules.extra ?? {}),
    }),
    tracks: doc.tracks.slice().sort((a, b) => a.no - b.no).map(canonicalTrack),
    cues: doc.cues.slice().sort(compareCues).map(canonicalCue),
    removed: doc.removed.length > 0 ? doc.removed : undefined,
    ...(doc.extra ?? {}),
  })
}

function canonicalTrack(track: Track): Record<string, unknown> {
  return compact({
    id: track.id,
    no: track.no,
    name: track.name,
    color: track.color,
    audio: track.audio ?? undefined,
    peaks: track.peaks ?? undefined,
    diar: track.diar,
    origin: track.origin,
    voice: track.voice,
    ...(track.extra ?? {}),
  })
}

function canonicalCue(cue: Cue): Record<string, unknown> {
  const tr: Record<string, unknown> = {}
  // Языки в алфавитном порядке: два редактора не должны спорить о порядке
  // ключей внутри перевода.
  for (const lang of Object.keys(cue.tr).sort()) {
    tr[lang] = { text: cue.tr[lang].text, status: cue.tr[lang].status }
  }
  return compact({
    id: cue.id,
    trackId: cue.trackId,
    startMs: cue.startMs,
    endMs: cue.endMs,
    text: cue.text,
    tr: Object.keys(tr).length > 0 ? tr : undefined,
    status: cue.status,
    rev: cue.rev,
    origin: cue.origin,
    movedFrom: cue.movedFrom,
    note: cue.note || undefined,
    voice: cue.voice,
    ...(cue.extra ?? {}),
  })
}

/** Убирает ключи со значением `undefined`, сохраняя порядок остальных. */
function compact(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

/**
 * Документ к записи: новая ревизия, автор и производитель.
 *
 * `revision` растёт на единицу от той, что была на сервере, — по ней и
 * определяется конфликт при следующей записи (§8 контракта).
 */
export function stampForSave(
  doc: DialogDoc,
  input: { revision: number; updatedBy: string; producer: string; at: string },
): DialogDoc {
  return {
    ...doc,
    revision: input.revision,
    updatedAt: input.at,
    updatedBy: input.updatedBy,
    producer: input.producer,
  }
}
