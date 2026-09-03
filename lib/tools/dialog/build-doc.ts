/**
 * Сборка `dialog.json` из того, что лежит в папке задачи.
 *
 * Зачем это здесь, а не в графе обработки. Документ — производная от папки:
 * дорожки видно по подпапкам, реплики и тайминги лежат в `orig.srt`, языки
 * читаются из имён файлов переводов. Всё, что нужно для сборки, у папки уже
 * есть, и требовать ради этого отдельную ноду значит требовать её ради работы,
 * которую можно сделать в момент открытия задачи.
 *
 * Чего сборка **не** знает и знать не может: имён персонажей и уверенности
 * диаризации. В голой папке их нет вовсе, поэтому дорожки называются номерами,
 * а `origin.name` не заполняется — восстановление имён честно скажет «нечего
 * восстанавливать», вместо того чтобы вернуть выдумку.
 *
 * Модуль чистый: ни React, ни сети, ни DOM. Скачивание файлов, длительность
 * медиа и запись результата — на вызывающем.
 */

import {
  DEFAULT_RULES,
  DOC_VERSION,
  TRACK_COLORS,
  type Cue,
  type DialogDoc,
  type Track,
} from "./dialog-doc"
import { mergeDialogDocs } from "./merge"
import { langFromName, pickSrtName } from "./srt-files"
import { pickVideoName, type VideoCandidate } from "./media-files"
import { parseSrt, srtByIndex } from "./srt-parse"

/** Файл папки задачи: путь папки относительно задачи (`""` — корень) и имя. */
export type TaskEntry = {
  dir: string
  name: string
  isFolder: boolean
  contentType?: string | null
}

export type BuildInput = {
  entries: TaskEntry[]
  /** Содержимое прочитанных `.srt` по пути относительно папки задачи. */
  srt: Map<string, string>
  /** Длительность материала. Берётся из медиа вызывающим; 0 — считаем по репликам. */
  durationMs: number
  /** Язык оригинала. Из имени файла его не узнать, поэтому спрашивается снаружи. */
  originalLang: string
  docId: string
  now: string
}

/** Что сборка заметила по дороге — показать человеку, а не молча проглотить. */
export type BuildNote =
  /** Папка есть, оригинала в ней нет: дорожка не собрана. */
  | { kind: "noOriginal"; dir: string }
  /** Файл перевода есть, а язык из имени не читается. */
  | { kind: "unknownLang"; file: string }
  /** В переводе нет блока с таким номером — реплика осталась без перевода. */
  | { kind: "shortTranslation"; file: string; missing: number }
  /** Ни одной дорожки: собирать нечего. */
  | { kind: "noTracks" }

export type BuildResult = { doc: DialogDoc; notes: BuildNote[] }

/** Какие файлы сборка вообще читает из папки дорожки. */
export function isSrt(name: string): boolean {
  return /\.srt$/i.test(name)
}

const AUDIO_EXTENSION = /\.(wav|mp3|m4a|aac|ogg|opus|flac)$/i

function isAudio(entry: TaskEntry): boolean {
  if (entry.isFolder) return false
  if (entry.contentType?.toLowerCase().startsWith("audio/")) return true
  return AUDIO_EXTENSION.test(entry.name)
}

/**
 * Папки дорожек — подпапки корня, в которых есть титры.
 *
 * Признак — именно `.srt` внутри, а не имя папки: пустая папка или папка со
 * служебными файлами дорожкой не является, а называться может как угодно.
 * Порядок — по имени, чтобы номера дорожек не зависели от порядка строк
 * каталога; номер берётся из имени, когда оно числовое (`01` → 1), иначе по
 * порядку — так у папок `01`, `02` номера совпадают с именами, а у свободных
 * имён остаются осмысленными.
 */
export function trackDirs(entries: TaskEntry[]): string[] {
  const dirs = new Set(
    entries.filter((e) => !e.isFolder && isSrt(e.name) && e.dir !== "").map((e) => e.dir),
  )
  // Только первый уровень: `01` — дорожка, `01/voice` — её содержимое.
  return [...dirs].filter((dir) => !dir.includes("/")).sort((a, b) => a.localeCompare(b))
}

/**
 * Собрать документ по содержимому папки.
 *
 * Порядок сборки повторяет то, как папку читает человек: дорожки → оригинал в
 * каждой → переводы рядом → медиа в корне. Всё, что не сошлось, не отменяет
 * сборку, а попадает в `notes`: пустой документ бесполезен, а документ с одной
 * несобранной дорожкой — рабочий.
 */
export function buildDocFromFolder(input: BuildInput): BuildResult {
  const notes: BuildNote[] = []
  const { entries, srt, originalLang } = input

  const namesIn = (dir: string) =>
    entries.filter((e) => !e.isFolder && e.dir === dir).map((e) => e.name)

  const tracks: Track[] = []
  const cues: Cue[] = []
  const targets = new Set<string>()

  trackDirs(entries).forEach((dir, index) => {
    const names = namesIn(dir)
    const originalName = pickSrtName(names, { kind: "original", lang: originalLang })
    if (!originalName) {
      notes.push({ kind: "noOriginal", dir })
      return
    }

    const no = /^\d+$/.test(dir) ? Number(dir) : index + 1
    const trackId = `t${String(no).padStart(2, "0")}`
    const audio = names.find((name) => isAudio({ dir, name, isFolder: false }))

    tracks.push({
      id: trackId,
      no,
      // Имени персонажа в папке нет — и выдумывать его нельзя: человек
      // переименует дорожку сам, а машинного имени здесь никогда не было.
      name: dir,
      color: TRACK_COLORS[index % TRACK_COLORS.length]!,
      audio: audio ? `${dir}/${audio}` : null,
      // Пики — отдельная работа вызывающего: их считают из звука, а не из папки.
      peaks: null,
      origin: { kind: "auto" },
    })

    const originalPath = `${dir}/${originalName}`
    const blocks = parseSrt(srt.get(originalPath) ?? "")

    /** Переводы этой дорожки: всё остальное сырьё, у которого читается язык. */
    const translations = new Map<string, ReturnType<typeof srtByIndex>>()
    for (const name of names) {
      if (!isSrt(name) || name === originalName) continue
      const lang = langFromName(name)
      if (!lang) {
        notes.push({ kind: "unknownLang", file: `${dir}/${name}` })
        continue
      }
      targets.add(lang)
      translations.set(lang, srtByIndex(parseSrt(srt.get(`${dir}/${name}`) ?? "")))
    }

    for (const block of blocks) {
      const tr: Cue["tr"] = {}
      for (const [lang, byIndex] of translations) {
        const match = byIndex.get(block.index)
        if (match) tr[lang] = { text: match.text, status: "draft" }
      }
      cues.push({
        // Идентификатор детерминированный: удалили документ, собрали заново —
        // те же реплики получают те же id, и внешние ссылки на них не рвутся.
        id: `c_${trackId}_${block.index}`,
        trackId,
        startMs: block.startMs,
        endMs: block.endMs,
        text: block.text,
        tr,
        status: "auto",
        rev: 0,
        origin: { kind: "auto", file: originalPath, index: block.index },
      })
    }

    for (const [lang, byIndex] of translations) {
      const missing = blocks.filter((block) => !byIndex.has(block.index)).length
      if (missing > 0) {
        notes.push({ kind: "shortTranslation", file: `${dir}/${lang}`, missing })
      }
    }
  })

  if (tracks.length === 0) notes.push({ kind: "noTracks" })

  const root = entries.filter((e) => !e.isFolder && e.dir === "")
  const video = pickVideoName(root as VideoCandidate[])
  // Общий звук отдельным файлом — когда материал звуковой и видео нет вовсе.
  const mix = video ? null : (root.find(isAudio)?.name ?? null)

  cues.sort((a, b) => a.startMs - b.startMs || a.trackId.localeCompare(b.trackId))
  const lastCueMs = cues.reduce((max, cue) => Math.max(max, cue.endMs), 0)

  return {
    doc: {
      format: "dialogDoc",
      version: DOC_VERSION,
      id: input.docId,
      revision: 0,
      updatedAt: input.now,
      updatedBy: "site:srt-editor",
      producer: "innovation-hub/srt-editor 0.1",
      media: {
        video,
        mix,
        peaks: null,
        // Медиа может не открыться или не быть вовсе — тогда длительность
        // задачи это конец последней реплики. Ноль здесь означал бы таймлинию
        // нулевой ширины при живых титрах.
        durationMs: Math.max(input.durationMs, lastCueMs),
        fps: null,
      },
      languages: { original: originalLang, targets: [...targets].sort() },
      rules: { ...DEFAULT_RULES },
      tracks,
      cues,
      removed: [],
    },
    notes,
  }
}

/**
 * Пересборка с сохранением правок: «в папке появилось новое».
 *
 * Обычный случай не «начать заново», а «докинули перевод»: папка обновилась, а
 * вычитку терять нельзя. Слияние (§8 контракта) решает это по `rev` — правленая
 * реплика старше только что собранной, — и работает потому, что сборка даёт
 * репликам те же id: пересобрали ту же папку — получили те же ключи.
 *
 * Чего слияние не делает само: у выигравшей реплики остаются её переводы, и
 * язык, которого в ней не было, так и не появился бы — а ради него всё и
 * затевалось. Поэтому недостающие переводы дописываются отдельно, и только
 * недостающие: свой перевод человека новая сборка не трогает.
 */
export function mergeRebuild(current: DialogDoc, fresh: DialogDoc): DialogDoc {
  const merged = mergeDialogDocs(current, fresh).doc
  const freshById = new Map(fresh.cues.map((cue) => [cue.id, cue]))

  const cues = merged.cues.map((cue) => {
    const incoming = freshById.get(cue.id)
    if (!incoming) return cue
    let added = false
    const tr = { ...cue.tr }
    for (const [lang, value] of Object.entries(incoming.tr)) {
      if (!tr[lang]) {
        tr[lang] = value
        added = true
      }
    }
    return added ? { ...cue, tr } : cue
  })

  return {
    ...merged,
    languages: {
      ...merged.languages,
      // Языки — объединение: новый перевод в папке должен дать колонку, а
      // язык, который человек добавил руками, не должен из документа исчезнуть.
      targets: [...new Set([...merged.languages.targets, ...fresh.languages.targets])].sort(),
    },
    cues,
  }
}
