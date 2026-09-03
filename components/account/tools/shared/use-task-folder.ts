"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  parseDialogDoc,
  type DialogDoc,
  type DocError,
  type DocWarning,
} from "@/lib/tools/dialog/dialog-doc"
import { pickVideoName } from "@/lib/tools/dialog/media-files"
import { parsePeaks, type Peaks } from "@/lib/tools/dialog/peaks"
import { pickSrtName, wantFromSourcePath } from "@/lib/tools/dialog/srt-files"
import { parseSrt, type SrtCue } from "@/lib/tools/dialog/srt-parse"
import type { ToolInstance } from "../tools-context"

/** Запись дерева хранилища — то, что отдаёт `/api/storage/v1/tree`. */
export type FolderEntry = {
  id: string
  name: string
  folderPath: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number | null
  /** Тип из каталога. У залитого мимо браузера файла бывает пустым. */
  contentType?: string | null
}

export type FolderState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready"
      doc: DialogDoc
      docFileId: string
      entries: FolderEntry[]
      warnings: DocWarning[]
    }

/** Имя документа в папке задачи — фиксировано контрактом (§8 плана). */
export const DOC_NAME = "dialog.json"

/** Почему документ не открылся — словами. Поводы перечислены в §6 контракта. */
export function docErrorText(
  t: {
    srtBadDocument: string
    srtDocNewer: string
    srtDocBadPath: string
    srtDocDuplicateTrack: string
    srtDocDuplicateCue: string
    srtDocUnknownTrack: string
    srtDocBadInterval: string
    srtDocMissingField: string
  },
  error: DocError,
): string {
  switch (error.kind) {
    case "missingField":
      return tf(t.srtDocMissingField, { field: error.field })
    case "newerVersion":
      return tf(t.srtDocNewer, { version: error.version })
    case "badPath":
      return tf(t.srtDocBadPath, { value: error.value })
    case "duplicateTrackId":
      return tf(t.srtDocDuplicateTrack, { value: error.id })
    case "duplicateTrackNo":
      return tf(t.srtDocDuplicateTrack, { value: String(error.no) })
    case "duplicateCueId":
      return tf(t.srtDocDuplicateCue, { value: error.id })
    case "unknownTrack":
      return tf(t.srtDocUnknownTrack, { value: error.cueId })
    case "badInterval":
      return tf(t.srtDocBadInterval, { value: error.cueId })
    default:
      return t.srtBadDocument
  }
}

/**
 * Путь внутри папки задачи → запись дерева.
 *
 * Пути в документе относительные (`01/audio.wav`), а дерево знает абсолютные:
 * склеиваем и ищем точное совпадение, чтобы файл с тем же именем в соседней
 * папке не подменил нужный.
 */
export function findEntry(
  entries: FolderEntry[],
  folderPath: string,
  relative: string | null,
): FolderEntry | null {
  if (!relative) return null
  const full = `${folderPath}/${relative}`.replace(/\/+/g, "/")
  const slash = full.lastIndexOf("/")
  const dir = full.slice(0, slash)
  const name = full.slice(slash + 1)
  return entries.find((e) => !e.isFolder && e.folderPath === dir && e.name === name) ?? null
}

/**
 * Видео задачи подбором, когда путь из документа не сошёлся.
 *
 * Имя исходника контрактом не закреплено: обработка кладёт в корень папки то,
 * что пришло от заказчика, а `media.video` может отставать или не быть вовсе.
 * Ищем только в корне папки задачи — глубже лежат дорожки и сырьё, и видео
 * оттуда было бы не тем файлом.
 *
 * Правила выбора (прокси → `mp4` → остальное) живут в
 * `lib/tools/dialog/media-files.ts`: они те же и для локального редактора.
 */
export function pickVideoEntry(
  entries: FolderEntry[],
  folderPath: string,
): FolderEntry | null {
  const own = entries.filter((e) => !e.isFolder && e.s3Key && e.folderPath === folderPath)
  const picked = pickVideoName(own)
  return picked ? (own.find((e) => e.name === picked) ?? null) : null
}

/**
 * Что с видео задачи — со всеми отказами по отдельности.
 *
 * Раньше на месте кадра стояла одна надпись «в папке не найдено», и её же
 * человек видел, когда файл лежал на месте, а ссылку не выдало хранилище.
 * Отказы разные, и чинятся они по-разному, поэтому и состояний несколько.
 */
export type TaskVideo =
  /** Видео нет ни в документе, ни в папке. */
  | { kind: "none" }
  /** Документ называет файл, а в папке нет ни его, ни другого видео. */
  | { kind: "missing"; file: string }
  /** Файл нашли, ссылку ещё подписываем. */
  | { kind: "loading"; entry: FolderEntry }
  /** Файл есть, ссылка выдана — играем. */
  | { kind: "ready"; entry: FolderEntry; url: string }
  /** Файл есть, а ссылки нет: хранилище отказало. */
  | { kind: "unavailable"; entry: FolderEntry }

/** Надпись вместо кадра — по состоянию, а не по наличию поля в документе. */
export function videoNoticeText(
  t: {
    srtNoVideo: string
    srtPreviewMissing: string
    srtVideoOpening: string
    srtVideoUnavailable: string
  },
  video: TaskVideo,
): string {
  switch (video.kind) {
    case "missing":
      return tf(t.srtPreviewMissing, { file: video.file })
    case "loading":
      return t.srtVideoOpening
    case "unavailable":
      return tf(t.srtVideoUnavailable, { file: video.entry.name })
    default:
      return t.srtNoVideo
  }
}

/**
 * Видео задачи: поиск в папке плюс подписанная ссылка.
 *
 * Путь из документа — подсказка, а не единственный источник: не сошёлся —
 * берём видео из корня папки. Документ при этом не правим: `media.video`
 * принадлежит контракту с программой, и переписывать его из-за того, что мы
 * подобрали файл сами, значило бы менять общий файл своей догадкой.
 */
export function useTaskVideo(
  projectId: string | null,
  folderPath: string | null,
  entries: FolderEntry[],
  doc: DialogDoc | null,
): TaskVideo {
  const declared = doc?.media.video ?? null
  const entry =
    doc && folderPath
      ? (findEntry(entries, folderPath, declared) ?? pickVideoEntry(entries, folderPath))
      : null
  const s3Key = entry?.s3Key ?? null
  const [signed, setSigned] = useState<{ s3Key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!projectId || !s3Key) {
      setSigned(null)
      return
    }
    let cancelled = false
    setSigned(null)
    void (async () => {
      const url = await signGet(projectId, s3Key)
      if (!cancelled) setSigned({ s3Key, url })
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, s3Key])

  if (!entry || !s3Key) {
    return declared ? { kind: "missing", file: declared } : { kind: "none" }
  }
  if (!signed || signed.s3Key !== s3Key) return { kind: "loading", entry }
  return signed.url ? { kind: "ready", entry, url: signed.url } : { kind: "unavailable", entry }
}

/**
 * Чтение папки задачи: дерево → `dialog.json` → разобранный документ.
 *
 * Инструмент на сайте работает только онлайн (§7): ничего не скачиваем и не
 * зеркалим, папка проекта в R2 — единственное место, где лежат файлы.
 */
export function useTaskFolder(tool: ToolInstance) {
  const [state, setState] = useState<FolderState>({ kind: "idle" })
  const { t } = useWorkspace()
  const tRef = useRef(t)
  tRef.current = t

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null

  const load = useCallback(async () => {
    if (!projectId || !folderPath) {
      setState({ kind: "idle" })
      return
    }
    setState({ kind: "loading" })
    try {
      const res = await fetch(
        `/api/storage/v1/tree?projectId=${encodeURIComponent(projectId)}&prefix=${encodeURIComponent(folderPath)}`,
      )
      if (!res.ok) {
        setState({ kind: "error", message: tRef.current.driveUnavailable })
        return
      }
      const data = await res.json()
      const entries = (data.entries ?? []) as FolderEntry[]
      const docEntry = entries.find(
        (e) => !e.isFolder && e.name === DOC_NAME && e.folderPath === folderPath,
      )
      if (!docEntry) {
        setState({ kind: "error", message: tRef.current.srtNoDocument })
        return
      }
      const fileRes = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/drive/files/${encodeURIComponent(docEntry.id)}`,
      )
      if (!fileRes.ok) {
        setState({ kind: "error", message: tRef.current.driveUnavailable })
        return
      }
      const parsed = parseDialogDoc(await fileRes.json())
      if (!parsed.ok) {
        // Отказ, а не попытка починить: документ общий с программой, и молча
        // исправленный файл испортил бы его у второй стороны (§6 контракта).
        setState({ kind: "error", message: docErrorText(tRef.current, parsed.error) })
        return
      }
      setState({
        kind: "ready",
        doc: parsed.doc,
        docFileId: docEntry.id,
        entries,
        warnings: parsed.warnings,
      })
    } catch {
      setState({ kind: "error", message: tRef.current.driveUnavailable })
    }
  }, [folderPath, projectId])

  useEffect(() => {
    void load()
  }, [load])

  return { state, reload: load }
}

/**
 * Ссылка на файл в хранилище для `<video>` / `<audio>`.
 *
 * Подписанный GET прямо в R2, а не наш роут скачивания: плееру нужен Range,
 * иначе перемотки нет — он умеет только доиграть до конца скачанное.
 */
export async function signGet(projectId: string, s3Key: string): Promise<string | null> {
  try {
    const res = await fetch("/api/storage/v1/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, method: "GET", s3Key, ttlSec: 3600 }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return typeof data.url === "string" ? data.url : null
  } catch {
    // Медиа не критично: без ссылки остаются титры и таймлиния (§15.1).
    return null
  }
}

/**
 * Ссылки на аудио дорожек — по ключу хранилища.
 *
 * Подписанное однажды держим в кэше на всё время работы: ссылка живёт час, а
 * пересоздавать её на каждое включение solo значило бы дёргать сеть ради того,
 * что уже есть.
 */
export function useSignedUrls(
  projectId: string | null,
  s3Keys: string[],
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const cache = useRef<Record<string, string>>({})
  const wanted = s3Keys.filter(Boolean).sort().join("\u0000")

  useEffect(() => {
    if (!projectId || !wanted) return
    const missing = wanted.split("\u0000").filter((key) => !cache.current[key])
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      for (const key of missing) {
        const url = await signGet(projectId, key)
        if (url) cache.current[key] = url
      }
      if (!cancelled) setUrls({ ...cache.current })
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, wanted])

  return urls
}

/**
 * Волны задачи: общая из `media.peaks` и свои у дорожек.
 *
 * Грузим одним заходом, а не хуком на дорожку: число дорожек меняется по ходу
 * работы, а порядок хуков меняться не может. Нет файла — полоса дорожки
 * пустая, и это не аварийный режим (§17.3).
 */
export function useDocPeaks(
  projectId: string | null,
  folderPath: string | null,
  entries: FolderEntry[],
  doc: DialogDoc | null,
): { main: Peaks | null; byTrack: Record<string, Peaks> } {
  const [state, setState] = useState<{ main: Peaks | null; byTrack: Record<string, Peaks> }>({
    main: null,
    byTrack: {},
  })

  const wanted = doc
    ? JSON.stringify([doc.media.peaks, doc.tracks.map((track) => [track.id, track.peaks])])
    : ""

  useEffect(() => {
    if (!projectId || !folderPath || !doc) {
      setState({ main: null, byTrack: {} })
      return
    }
    let cancelled = false

    const fetchPeaks = async (relative: string | null): Promise<Peaks | null> => {
      const entry = findEntry(entries, folderPath, relative)
      if (!entry?.s3Key) return null
      try {
        const url = await signGet(projectId, entry.s3Key)
        if (!url) return null
        const file = await fetch(url)
        if (!file.ok) return null
        return parsePeaks(await file.json())
      } catch {
        return null
      }
    }

    void (async () => {
      const main = await fetchPeaks(doc.media.peaks)
      const byTrack: Record<string, Peaks> = {}
      for (const track of doc.tracks) {
        const peaks = await fetchPeaks(track.peaks)
        if (peaks) byTrack[track.id] = peaks
      }
      if (!cancelled) setState({ main, byTrack })
    })()

    return () => {
      cancelled = true
    }
    // Пересобираем только когда поменялись сами пути к волнам: `entries` —
    // новый массив на каждую перезагрузку папки, по нему сравнивать нечего.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, folderPath, wanted])

  return state
}

/**
 * Файл титров в папке дорожки, когда точного имени в ней нет.
 *
 * Имена сырья контрактом не закреплены — обработка кладёт `original.srt` или
 * `dialog_rus.srt`, — поэтому язык ищется в имени (`lib/tools/dialog/srt-files.ts`).
 * Ищем строго в той папке, которую назвал путь: сосед по другой дорожке — это
 * чужой текст, и подставить его молча нельзя.
 */
function resolveSrtEntry(
  entries: FolderEntry[],
  folderPath: string,
  relative: string,
  originalLang: string | null,
): FolderEntry | null {
  const want = wantFromSourcePath(relative, originalLang)
  if (!want) return null
  const full = `${folderPath}/${relative}`.replace(/\/+/g, "/")
  const dir = full.slice(0, full.lastIndexOf("/"))
  const inDir = entries.filter((e) => !e.isFolder && e.folderPath === dir && e.s3Key)
  const picked = pickSrtName(
    inDir.map((e) => e.name),
    want,
  )
  return picked ? (inDir.find((e) => e.name === picked) ?? null) : null
}

/**
 * Сырьё титров из папки — для восстановления.
 *
 * Читается по требованию, а не при открытии задачи: файлы нужны только когда
 * человек решил откатить правки, а на открытии это лишние запросы к хранилищу на
 * каждую дорожку и каждый язык.
 *
 * Чего нет в папке, того нет и в ответе: вызывающий по разнице путей видит, что
 * восстанавливать было не из чего, и говорит об этом человеку.
 *
 * Ключи ответа — те же пути, что просили, даже когда файл нашёлся под другим
 * именем: восстановление сопоставляет реплики по `origin.file`, и подменять ему
 * ключи на настоящие имена значило бы чинить поиск ценой поломки сопоставления.
 */
export async function loadSrtSources(
  projectId: string | null,
  folderPath: string | null,
  entries: FolderEntry[],
  paths: string[],
  /** Язык оригинала из документа: по нему узнаётся `..._eng.srt` без слова «original». */
  originalLang: string | null = null,
): Promise<Map<string, SrtCue[]>> {
  const out = new Map<string, SrtCue[]>()
  if (!projectId || !folderPath) return out

  for (const relative of paths) {
    const entry =
      findEntry(entries, folderPath, relative) ??
      resolveSrtEntry(entries, folderPath, relative, originalLang)
    if (!entry?.s3Key) continue
    try {
      const url = await signGet(projectId, entry.s3Key)
      if (!url) continue
      const file = await fetch(url)
      if (!file.ok) continue
      const cues = parseSrt(await file.text())
      if (cues.length > 0) out.set(relative, cues)
    } catch {
      // Недоступный файл — просто отсутствующее сырьё, не ошибка задачи.
    }
  }
  return out
}

/**
 * Волны по путям — для тейков озвучки и всего, что появляется по ходу работы.
 *
 * Отдельно от `useDocPeaks`, потому что список путей здесь меняется от действий
 * человека: сгенерировал тейк — появился ещё один файл. Прочитанное держим в
 * кэше на всё время работы: файлы маленькие, а перечитывать их на каждую
 * перерисовку незачем.
 */
export function usePeaksByPath(
  projectId: string | null,
  folderPath: string | null,
  entries: FolderEntry[],
  paths: string[],
): Record<string, Peaks> {
  const [peaks, setPeaks] = useState<Record<string, Peaks>>({})
  const cache = useRef<Record<string, Peaks>>({})
  const missing = useRef(new Set<string>())
  const wanted = paths.filter(Boolean).sort().join("\u0000")

  useEffect(() => {
    if (!projectId || !folderPath || !wanted) return
    const list = wanted.split("\u0000")
    const todo = list.filter((path) => !cache.current[path] && !missing.current.has(path))
    if (todo.length === 0) return
    let cancelled = false

    void (async () => {
      let added = false
      for (const path of todo) {
        const entry = findEntry(entries, folderPath, path)
        if (!entry?.s3Key) {
          // Файла в папке нет: помечаем, чтобы не спрашивать о нём каждый раз.
          missing.current.add(path)
          continue
        }
        try {
          const url = await signGet(projectId, entry.s3Key)
          if (!url) continue
          const file = await fetch(url)
          if (!file.ok) continue
          const parsed = parsePeaks(await file.json())
          if (parsed) {
            cache.current[path] = parsed
            added = true
          } else {
            missing.current.add(path)
          }
        } catch {
          // Недоступная волна — клип нарисуется без неё.
        }
      }
      if (added && !cancelled) setPeaks({ ...cache.current })
    })()

    return () => {
      cancelled = true
    }
    // `entries` — новый массив на каждую перезагрузку папки, сравнивать по нему
    // нечего; список путей и так в зависимостях строкой.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, folderPath, wanted])

  return peaks
}
