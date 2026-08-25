"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  parseDialogDoc,
  type DialogDoc,
  type DocError,
  type DocWarning,
} from "@/lib/tools/srt/dialog-doc"
import { parsePeaks, type Peaks } from "@/lib/tools/srt/peaks"
import type { ToolInstance } from "../tools-context"

/** Запись дерева хранилища — то, что отдаёт `/api/storage/v1/tree`. */
export type FolderEntry = {
  id: string
  name: string
  folderPath: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number | null
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
  },
  error: DocError,
): string {
  switch (error.kind) {
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

export function useSignedUrl(projectId: string | null, s3Key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !s3Key) {
      setUrl(null)
      return
    }
    let cancelled = false
    void (async () => {
      const signed = await signGet(projectId, s3Key)
      if (!cancelled) setUrl(signed)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, s3Key])

  return url
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
