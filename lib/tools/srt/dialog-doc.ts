/**
 * Модель документа `dialog.json` и операции над ней.
 *
 * Контракт формата — [docs/DIALOG_FORMAT.md](../../../docs/DIALOG_FORMAT.md);
 * здесь только код, который его читает и меняет. Ни React, ни компонентов: файл
 * целиком переезжает в локальный редактор программы (§20.1 плана).
 *
 * Все операции — чистые: принимают документ, возвращают новый. Поэтому undo —
 * это стек снимков ссылок, а не обратные действия (§18.2).
 */

/** Порядок реплик в файле: `startMs`, затем `trackId`, затем `id` (§2.4). */
export function compareCues(a: Cue, b: Cue): number {
  return (
    a.startMs - b.startMs ||
    a.trackId.localeCompare(b.trackId) ||
    a.id.localeCompare(b.id)
  )
}

export type CueStatus = "auto" | "edited" | "approved" | "conflict"
export type TranslationStatus = "draft" | "approved" | "conflict"

export type Translation = {
  text: string
  status: TranslationStatus
}

export type Cue = {
  id: string
  trackId: string
  startMs: number
  endMs: number
  text: string
  /** Перевод по коду языка. Языков может не быть вовсе. */
  tr: Record<string, Translation>
  status: CueStatus
  rev: number
  origin?: {
    kind: "auto" | "manual"
    file?: string
    index?: number
    speaker?: string
    confidence?: number
  }
  movedFrom?: string
  note?: string
  voice?: { takes: unknown[] }
  /** Поля, которых не знает эта реализация. Записываются обратно как есть. */
  extra?: Record<string, unknown>
}

export type Track = {
  id: string
  no: number
  name: string
  color: string
  /** Свой аудиофайл дорожки; у дорожки персонажа его обычно нет. */
  audio: string | null
  /** Свои пики; пусто — рисуем общую волну приглушённо (§17.3). */
  peaks: string | null
  diar?: { engine?: string; speaker?: string; confidence?: number }
  /**
   * Откуда взялась дорожка и как её назвала автоматика.
   *
   * Единственное место, где хранится машинное имя: `name` человек переименует, и
   * прежнее значение больше негде взять — в сырье папки имён дорожек нет вовсе.
   * Без этого поля «восстановить имена» было бы обещанием, которое нечем
   * выполнить.
   */
  origin?: { kind: "auto" | "manual"; name?: string }
  voice?: { provider: string | null; voiceId: string | null; params: Record<string, unknown> }
  extra?: Record<string, unknown>
}

export type DialogRules = {
  maxCps: number
  maxTranslationRatio: number
  minDurationMs: number
  minGapMs: number
  overlapWithinTrack: "forbid" | "warn"
  extra?: Record<string, unknown>
}

export type DialogDoc = {
  format: "dialogDoc"
  version: number
  id: string
  revision: number
  updatedAt: string
  updatedBy: string
  producer: string
  media: {
    video: string | null
    mix: string | null
    peaks: string | null
    durationMs: number
    fps: number | null
    extra?: Record<string, unknown>
  }
  languages: { original: string; targets: string[]; extra?: Record<string, unknown> }
  rules: DialogRules
  tracks: Track[]
  cues: Cue[]
  removed: { id: string; at: string }[]
  extra?: Record<string, unknown>
}

/**
 * Цвета дорожек, когда конвейер их не проставил.
 *
 * Взяты из палитры дизайна: синий — речь, янтарный — плашки, зелёный — форс,
 * фиолетовый — комментарии. Дальше по кругу: важно только, чтобы соседние
 * дорожки различались, а не чтобы цвет что-то значил.
 */
export const TRACK_COLORS = ["#5b9be0", "#e0a33a", "#2ea36b", "#8b6fd6", "#d2708a", "#4fb3c4"]

/**
 * Из чего человек выбирает цвет дорожки руками.
 *
 * Не пипетка и не колесо: цвет здесь — метка персонажа, и её задача одна —
 * отличаться от соседней. Свободный выбор на тёмном фоне даёт нечитаемые
 * оттенки, поэтому набор фиксированный и проверенный на этом фоне.
 */
export const TRACK_PALETTE = [
  "#5b9be0",
  "#4fb3c4",
  "#2ea36b",
  "#8fbf3f",
  "#e0a33a",
  "#e07a3a",
  "#d2708a",
  "#c05fd0",
  "#8b6fd6",
  "#6f7fd6",
  "#9aa0ab",
  "#5f6a7a",
]

export const DEFAULT_RULES: DialogRules = {
  maxCps: 25,
  maxTranslationRatio: 1.2,
  minDurationMs: 250,
  minGapMs: 80,
  overlapWithinTrack: "forbid",
}

/** Единственная поддерживаемая major-версия документа (правило §2.6). */
export const DOC_VERSION = 1

/**
 * Причина отказа открыть документ (§6 контракта).
 *
 * Отказ, а не молчаливая починка: документ общий с программой, и «поправили и
 * записали обратно» испортило бы файл у второй стороны. Текст ошибки подбирает
 * интерфейс — здесь только повод.
 */
export type DocError =
  | { kind: "notOurFile" }
  | { kind: "newerVersion"; version: number }
  | { kind: "missingField"; field: string }
  | { kind: "badPath"; value: string }
  | { kind: "duplicateTrackId"; id: string }
  | { kind: "duplicateTrackNo"; no: number }
  | { kind: "duplicateCueId"; id: string }
  | { kind: "unknownTrack"; cueId: string }
  | { kind: "badInterval"; cueId: string }

/** Замечание: показать человеку, но открыть можно. */
export type DocWarning =
  | { kind: "beyondDuration"; count: number }
  | { kind: "extraLanguages"; langs: string[] }

export type ParseResult =
  | { ok: true; doc: DialogDoc; warnings: DocWarning[] }
  | { ok: false; error: DocError }

const DOC_KEYS = [
  "format",
  "version",
  "id",
  "revision",
  "updatedAt",
  "updatedBy",
  "producer",
  "media",
  "languages",
  "rules",
  "tracks",
  "cues",
  "removed",
] as const
const MEDIA_KEYS = ["video", "mix", "peaks", "durationMs", "fps"] as const
const LANG_KEYS = ["original", "targets"] as const
const RULES_KEYS = [
  "maxCps",
  "maxTranslationRatio",
  "minDurationMs",
  "minGapMs",
  "overlapWithinTrack",
] as const
const TRACK_KEYS = [
  "id",
  "no",
  "name",
  "color",
  "audio",
  "peaks",
  "diar",
  "origin",
  "voice",
] as const
const CUE_KEYS = [
  "id",
  "trackId",
  "startMs",
  "endMs",
  "text",
  "tr",
  "status",
  "rev",
  "origin",
  "movedFrom",
  "note",
  "voice",
] as const

/** Путь внутри документа: относительный, только вперёд (правило §2.7). */
const BAD_PATH = /^(\/|[a-zA-Z]:)|(^|\/)\.\.(\/|$)/

/**
 * Разбор того, что лежит в папке.
 *
 * Документ приходит из чужой программы, поэтому проверяем всё в порядке §6 и
 * ничего не дописываем молча. Неизвестные поля складываются в `extra` на каждом
 * уровне и возвращаются на место при записи — без этого сайт терял бы поля,
 * которые программа добавила под озвучку (правило §2.5).
 */
export function parseDialogDoc(input: unknown): ParseResult {
  if (!input || typeof input !== "object") return { ok: false, error: { kind: "notOurFile" } }
  const raw = input as Record<string, unknown>
  if (raw.format !== "dialogDoc") return { ok: false, error: { kind: "notOurFile" } }

  const version = num(raw.version)
  if (version == null) return { ok: false, error: { kind: "missingField", field: "version" } }
  if (version > DOC_VERSION) return { ok: false, error: { kind: "newerVersion", version } }

  // `id` и `revision` — обязательные по §6 контракта. Без `revision` документ не
  // может участвовать в определении «кто новее», и слияние теряет опору.
  const docId = str(raw.id)
  if (!docId) return { ok: false, error: { kind: "missingField", field: "id" } }
  const revision = num(raw.revision)
  if (revision == null || revision < 0) {
    return { ok: false, error: { kind: "missingField", field: "revision" } }
  }

  const media = obj(raw.media)
  const languages = obj(raw.languages)
  const rules = obj(raw.rules)

  const paths = [str(media.video), str(media.mix), str(media.peaks)]
  const rawTracks = Array.isArray(raw.tracks) ? raw.tracks : []
  for (const item of rawTracks) {
    const t = obj(item)
    paths.push(str(t.audio), str(t.peaks))
  }
  for (const value of paths) {
    if (value && BAD_PATH.test(value)) return { ok: false, error: { kind: "badPath", value } }
  }

  const tracks: Track[] = []
  const seenTrackIds = new Set<string>()
  const seenTrackNos = new Set<number>()
  for (const [index, item] of rawTracks.entries()) {
    const t = obj(item)
    const id = str(t.id) || `t${String(index + 1).padStart(2, "0")}`
    if (seenTrackIds.has(id)) return { ok: false, error: { kind: "duplicateTrackId", id } }
    seenTrackIds.add(id)
    const no = num(t.no) ?? index + 1
    if (seenTrackNos.has(no)) return { ok: false, error: { kind: "duplicateTrackNo", no } }
    seenTrackNos.add(no)
    tracks.push({
      id,
      no,
      name: str(t.name) || `#${index + 1}`,
      color: str(t.color) || TRACK_COLORS[index % TRACK_COLORS.length],
      audio: str(t.audio) || null,
      peaks: str(t.peaks) || null,
      diar: (t.diar as Track["diar"]) ?? undefined,
      origin: (t.origin as Track["origin"]) ?? undefined,
      voice: (t.voice as Track["voice"]) ?? undefined,
      extra: extrasOf(t, TRACK_KEYS),
    })
  }
  tracks.sort((a, b) => a.no - b.no)

  const durationMs = Math.max(0, Math.round(num(media.durationMs) ?? 0))
  const targets = Array.isArray(languages.targets)
    ? languages.targets.filter((x): x is string => typeof x === "string")
    : []

  const cues: Cue[] = []
  const seenCueIds = new Set<string>()
  let beyond = 0
  const extraLangs = new Set<string>()
  const rawCues = Array.isArray(raw.cues) ? raw.cues : []
  for (const [index, item] of rawCues.entries()) {
    const c = obj(item)
    const id = str(c.id) || `c_${index}`
    if (seenCueIds.has(id)) return { ok: false, error: { kind: "duplicateCueId", id } }
    seenCueIds.add(id)
    const trackId = str(c.trackId)
    if (!seenTrackIds.has(trackId)) return { ok: false, error: { kind: "unknownTrack", cueId: id } }
    const startMs = num(c.startMs)
    const endMs = num(c.endMs)
    if (startMs == null || endMs == null || startMs < 0 || endMs <= startMs) {
      return { ok: false, error: { kind: "badInterval", cueId: id } }
    }
    // Превышение длительности — предупреждение, а не отказ: длину материала
    // могли записать неточно.
    if (durationMs > 0 && endMs > durationMs) beyond += 1
    const tr = parseTranslations(c.tr)
    for (const lang of Object.keys(tr)) {
      if (!targets.includes(lang)) extraLangs.add(lang)
    }
    cues.push({
      id,
      trackId,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
      text: str(c.text) ?? "",
      tr,
      status: (["auto", "edited", "approved", "conflict"] as const).includes(
        c.status as CueStatus,
      )
        ? (c.status as CueStatus)
        : "auto",
      rev: num(c.rev) ?? 1,
      origin: (c.origin as Cue["origin"]) ?? undefined,
      movedFrom: str(c.movedFrom) || undefined,
      note: str(c.note) ?? "",
      voice: (c.voice as Cue["voice"]) ?? undefined,
      extra: extrasOf(c, CUE_KEYS),
    })
  }

  const warnings: DocWarning[] = []
  if (beyond > 0) warnings.push({ kind: "beyondDuration", count: beyond })
  // Лишние языки сохраняются, но не показываются: иначе перевод пропадёт при
  // удалении языка из списка (§6 пункт 7).
  if (extraLangs.size > 0) warnings.push({ kind: "extraLanguages", langs: [...extraLangs] })

  return {
    ok: true,
    warnings,
    doc: {
      format: "dialogDoc",
      version,
      id: docId,
      revision,
      updatedAt: str(raw.updatedAt) || new Date(0).toISOString(),
      updatedBy: str(raw.updatedBy) ?? "",
      producer: str(raw.producer) ?? "",
      media: {
        video: str(media.video) || null,
        mix: str(media.mix) || null,
        peaks: str(media.peaks) || null,
        durationMs,
        fps: num(media.fps) ?? null,
        extra: extrasOf(media, MEDIA_KEYS),
      },
      languages: {
        original: str(languages.original) || "und",
        targets,
        extra: extrasOf(languages, LANG_KEYS),
      },
      rules: {
        maxCps: num(rules.maxCps) ?? DEFAULT_RULES.maxCps,
        maxTranslationRatio: num(rules.maxTranslationRatio) ?? DEFAULT_RULES.maxTranslationRatio,
        minDurationMs: num(rules.minDurationMs) ?? DEFAULT_RULES.minDurationMs,
        minGapMs: num(rules.minGapMs) ?? DEFAULT_RULES.minGapMs,
        overlapWithinTrack: rules.overlapWithinTrack === "warn" ? "warn" : "forbid",
        extra: extrasOf(rules, RULES_KEYS),
      },
      tracks,
      cues: cues.sort(compareCues),
      removed: Array.isArray(raw.removed)
        ? (raw.removed as { id: string; at: string }[]).filter(
            (r) => r && typeof r.id === "string",
          )
        : [],
      extra: extrasOf(raw, DOC_KEYS),
    },
  }
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

/** Поля, которых мы не знаем: сохранить и записать обратно (правило §2.5). */
function extrasOf(
  source: Record<string, unknown>,
  known: readonly string[],
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (!known.includes(key)) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Полная длительность материала: медиа и реплики, что длиннее. */
export function docDurationMs(doc: DialogDoc): number {
  const lastCue = doc.cues.reduce((max, c) => Math.max(max, c.endMs), 0)
  return Math.max(doc.media.durationMs, lastCue)
}

export function findTrack(doc: DialogDoc, trackId: string): Track | null {
  return doc.tracks.find((t) => t.id === trackId) ?? null
}

export function findCue(doc: DialogDoc, cueId: string): Cue | null {
  return doc.cues.find((c) => c.id === cueId) ?? null
}

/** Перевод реплики на язык `lang` — пустая строка, если его ещё нет. */
export function translationOf(cue: Cue, lang: string): string {
  return cue.tr[lang]?.text ?? ""
}

// ── Операции (§18.1). Закрытый список: всё, что меняет документ, здесь ──

export function patchCue(doc: DialogDoc, cueId: string, patch: Partial<Cue>): DialogDoc {
  return withCues(
    doc,
    doc.cues.map((c) => (c.id === cueId ? bump({ ...c, ...patch }) : c)),
  )
}

export function setCueText(doc: DialogDoc, cueId: string, text: string): DialogDoc {
  return patchCue(doc, cueId, { text })
}

export function setCueTranslation(
  doc: DialogDoc,
  cueId: string,
  lang: string,
  text: string,
): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue) return doc
  const prev = cue.tr[lang]
  return patchCue(doc, cueId, {
    tr: { ...cue.tr, [lang]: { text, status: prev?.status === "approved" ? "approved" : "draft" } },
  })
}

/** Сдвиг и растягивание. Границы уже посчитаны вызывающим (drag, ввод в поле). */
export function setCueTiming(
  doc: DialogDoc,
  cueId: string,
  startMs: number,
  endMs: number,
  trackId?: string,
): DialogDoc {
  const start = Math.max(0, Math.round(startMs))
  const end = Math.max(start + 1, Math.round(endMs))
  return patchCue(doc, cueId, trackId ? { startMs: start, endMs: end, trackId } : { startMs: start, endMs: end })
}

/**
 * Перенос реплики на другую дорожку — самая частая правка на реальных данных:
 * автоматика ошибается персонажем чаще, чем таймингом. Откуда пришла реплика,
 * запоминаем в `movedFrom`: по нему потом видно, где автоматика промахнулась.
 */
export function moveCueToTrack(doc: DialogDoc, cueId: string, trackId: string): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue || cue.trackId === trackId) return doc
  return patchCue(doc, cueId, { trackId, movedFrom: cue.movedFrom ?? cue.trackId })
}

export function addCue(
  doc: DialogDoc,
  trackId: string,
  startMs: number,
  endMs: number,
  id: string,
): DialogDoc {
  const cue: Cue = {
    id,
    trackId,
    startMs: Math.max(0, Math.round(startMs)),
    endMs: Math.max(Math.round(startMs) + 1, Math.round(endMs)),
    text: "",
    tr: {},
    status: "edited",
    rev: 1,
    origin: { kind: "manual" },
    note: "",
  }
  return withCues(doc, doc.cues.concat([cue]))
}

export function removeCue(doc: DialogDoc, cueId: string, at: string): DialogDoc {
  if (!findCue(doc, cueId)) return doc
  return {
    ...withCues(
      doc,
      doc.cues.filter((c) => c.id !== cueId),
    ),
    // Удалённые помним: иначе слияние с чужой версией документа воскресит их
    // (§8 контракта формата).
    removed: doc.removed.concat([{ id: cueId, at }]),
  }
}

/** Разрез реплики в точке `atMs`: левая половина остаётся, правая — новая. */
export function splitCue(doc: DialogDoc, cueId: string, atMs: number, newId: string): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue) return doc
  const at = Math.round(atMs)
  // Слишком близко к краю — это промах мимо клипа, а не намерение разрезать.
  if (at <= cue.startMs + 100 || at >= cue.endMs - 100) return doc
  const right: Cue = {
    ...cue,
    id: newId,
    startMs: at,
    endMs: cue.endMs,
    rev: 1,
    status: "edited",
    origin: { kind: "manual" },
  }
  return withCues(
    doc,
    doc.cues.map((c) => (c.id === cueId ? bump({ ...c, endMs: at }) : c)).concat([right]),
  )
}

/**
 * Соседи реплики по её дорожке.
 *
 * «Сосед» считается по порядку внутри дорожки, а не по времени вообще: между
 * двумя репликами одной дорожки может лежать реплика другого персонажа, и она
 * соседству не мешает — они и говорят одновременно.
 */
export function trackNeighbours(
  doc: DialogDoc,
  cueId: string,
): { previous: Cue | null; next: Cue | null } {
  const cue = findCue(doc, cueId)
  if (!cue) return { previous: null, next: null }
  const own = doc.cues.filter((c) => c.trackId === cue.trackId).slice().sort(compareCues)
  const index = own.findIndex((c) => c.id === cueId)
  if (index < 0) return { previous: null, next: null }
  return { previous: own[index - 1] ?? null, next: own[index + 1] ?? null }
}

/**
 * Можно ли объединить две реплики.
 *
 * Только соседние и только на одной дорожке. Объединение через голову третьей
 * реплики съело бы её текст, а объединение поперёк дорожек означало бы, что двух
 * персонажей склеили в одного, — обе ошибки замечают не сразу, поэтому их проще
 * запретить, чем потом искать.
 */
export function canMergeCues(doc: DialogDoc, aId: string, bId: string): boolean {
  if (aId === bId) return false
  const { previous, next } = trackNeighbours(doc, aId)
  return previous?.id === bId || next?.id === bId
}

/**
 * Объединение двух соседних реплик: начало от первой, конец от последней,
 * тексты через пробел. Порядок аргументов не важен.
 */
export function mergeCues(doc: DialogDoc, aId: string, bId: string): DialogDoc {
  if (!canMergeCues(doc, aId, bId)) return doc
  const a = findCue(doc, aId)
  const b = findCue(doc, bId)
  if (!a || !b) return doc
  return mergeCueWithNext(doc, a.startMs <= b.startMs ? a.id : b.id)
}

/** Какая из двух реплик останется после объединения — та, что раньше. */
export function mergeSurvivorId(doc: DialogDoc, aId: string, bId: string): string | null {
  const a = findCue(doc, aId)
  const b = findCue(doc, bId)
  if (!a || !b) return null
  return a.startMs <= b.startMs ? a.id : b.id
}

/** Склейка со следующей репликой той же дорожки: тексты через пробел. */
export function mergeCueWithNext(doc: DialogDoc, cueId: string): DialogDoc {
  const cue = findCue(doc, cueId)
  if (!cue) return doc
  const next = doc.cues
    .filter((c) => c.trackId === cue.trackId && c.startMs > cue.startMs)
    .sort(compareCues)[0]
  if (!next) return doc
  const tr: Record<string, Translation> = {}
  for (const lang of new Set([...Object.keys(cue.tr), ...Object.keys(next.tr)])) {
    tr[lang] = {
      text: joinText(cue.tr[lang]?.text, next.tr[lang]?.text),
      status: "draft",
    }
  }
  return withCues(
    doc,
    doc.cues
      .filter((c) => c.id !== next.id)
      .map((c) =>
        c.id === cueId
          ? bump({
              ...c,
              // На всякий случай `max`: если реплики перекрывались, конец
              // объединённой — самый поздний из двух, а не конец второй.
              endMs: Math.max(c.endMs, next.endMs),
              text: joinText(c.text, next.text),
              tr,
            })
          : c,
      ),
  )
}

/**
 * Добавить язык перевода.
 *
 * Языки живут в документе (`languages.targets`), а не в настройках инструмента:
 * это свойство задачи, и следующий шаг — озвучка — читает их оттуда же. Порядок
 * списка задаёт порядок колонок в редакторе, поэтому новый язык встаёт в конец.
 */
export function addLanguage(doc: DialogDoc, code: string): DialogDoc {
  const lang = code.trim().toLowerCase()
  if (!lang || doc.languages.targets.includes(lang) || lang === doc.languages.original) return doc
  return {
    ...doc,
    languages: { ...doc.languages, targets: doc.languages.targets.concat([lang]) },
  }
}

/** Убрать язык вместе с его переводами — правка разрушительная, спрашивать выше. */
export function removeLanguage(doc: DialogDoc, code: string): DialogDoc {
  if (!doc.languages.targets.includes(code)) return doc
  return {
    ...doc,
    languages: {
      ...doc.languages,
      targets: doc.languages.targets.filter((lang) => lang !== code),
    },
    cues: doc.cues.map((cue) => {
      if (!(code in cue.tr)) return cue
      const tr = { ...cue.tr }
      delete tr[code]
      return { ...cue, tr }
    }),
  }
}

export function renameTrack(doc: DialogDoc, trackId: string, name: string): DialogDoc {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === trackId ? { ...t, name } : t)),
  }
}

/** Цвет дорожки — поле документа, значит выбор человека переживает перезагрузку. */
export function setTrackColor(doc: DialogDoc, trackId: string, color: string): DialogDoc {
  return {
    ...doc,
    tracks: doc.tracks.map((t) => (t.id === trackId ? { ...t, color } : t)),
  }
}

export function addTrack(doc: DialogDoc, id: string, name: string): DialogDoc {
  const no = doc.tracks.reduce((max, t) => Math.max(max, t.no), 0) + 1
  return {
    ...doc,
    tracks: doc.tracks.concat([
      {
        id,
        no,
        name,
        color: TRACK_COLORS[doc.tracks.length % TRACK_COLORS.length],
        audio: null,
        peaks: null,
        // Дорожку завёл человек: восстанавливать её имя не из чего и не нужно.
        origin: { kind: "manual" },
      },
    ]),
  }
}

/**
 * Убрать дорожку вместе с её репликами.
 *
 * Реплики уходят в `removed`, а не просто исчезают: без этого повторный прогон
 * обработки вернёт их обратно, и удаление придётся делать снова.
 */
export function removeTrack(doc: DialogDoc, trackId: string, at: string): DialogDoc {
  if (!findTrack(doc, trackId)) return doc
  const dropped = doc.cues.filter((cue) => cue.trackId === trackId)
  return {
    ...doc,
    tracks: doc.tracks.filter((track) => track.id !== trackId),
    cues: doc.cues.filter((cue) => cue.trackId !== trackId),
    removed: doc.removed.concat(dropped.map((cue) => ({ id: cue.id, at }))),
  }
}

/**
 * Переставить дорожку на одну позицию.
 *
 * Порядок дорожек — это `no`, и он же имя папки сырья. Менять `no` нельзя:
 * ссылки в `origin` перестанут сходиться. Поэтому меняются местами сами номера
 * у двух дорожек, а папки остаются за своими репликами.
 */
export function moveTrack(doc: DialogDoc, trackId: string, direction: -1 | 1): DialogDoc {
  const ordered = doc.tracks.slice().sort((a, b) => a.no - b.no)
  const index = ordered.findIndex((track) => track.id === trackId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ordered.length) return doc
  const a = ordered[index]
  const b = ordered[target]
  return {
    ...doc,
    // Меняются и номера, и порядок в массиве. Номер — это порядок для файла, а
    // массив — то, в чём его видит интерфейс: поменять только номера значит
    // ничего не поменять на экране до следующего перечитывания документа.
    tracks: doc.tracks
      .map((track) =>
        track.id === a.id
          ? { ...track, no: b.no }
          : track.id === b.id
            ? { ...track, no: a.no }
            : track,
      )
      .sort((x, y) => x.no - y.no),
  }
}

/**
 * Слияние дорожек — главная операция на реальных данных (§17.9): диаризация
 * дробит одного человека на две-три дорожки, и человек их собирает обратно.
 */
export function mergeTracks(doc: DialogDoc, fromId: string, intoId: string): DialogDoc {
  if (fromId === intoId) return doc
  return {
    ...doc,
    tracks: doc.tracks.filter((t) => t.id !== fromId),
    cues: doc.cues
      .map((c) => (c.trackId === fromId ? { ...c, trackId: intoId, movedFrom: c.movedFrom ?? fromId } : c))
      .sort(compareCues),
  }
}

// ── Внутреннее ──

function withCues(doc: DialogDoc, cues: Cue[]): DialogDoc {
  return { ...doc, cues: cues.slice().sort(compareCues) }
}

/**
 * Счётчик правок реплики. Нужен слиянию: без него две версии документа
 * неразличимы, и «кто новее» приходится решать по времени файла.
 */
function bump(cue: Cue): Cue {
  return { ...cue, rev: cue.rev + 1, status: cue.status === "auto" ? "edited" : cue.status }
}

function joinText(a: string | undefined, b: string | undefined): string {
  return [a ?? "", b ?? ""].map((s) => s.trim()).filter(Boolean).join(" ")
}

function parseTranslations(input: unknown): Record<string, Translation> {
  if (!input || typeof input !== "object") return {}
  const out: Record<string, Translation> = {}
  for (const [lang, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue
    const v = value as Record<string, unknown>
    out[lang] = {
      text: str(v.text) ?? "",
      status:
        v.status === "approved" || v.status === "conflict"
          ? (v.status as TranslationStatus)
          : "draft",
    }
  }
  return out
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
