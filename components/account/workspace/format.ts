import {
  FileText,
  Folder,
  Image as ImageIcon,
  Music,
  Video,
  type LucideIcon,
} from "lucide-react"

import type { Dictionary } from "@/components/account/i18n"
import type { DriveFile, Project } from "./types"

export function fmtSize(bytes: number | null) {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export function fmtDate(iso: string | null, lang: string) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

export function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, "0")}:${String(
      d.getMinutes(),
    ).padStart(2, "0")}`
  } catch {
    return ""
  }
}

export function fileIcon(f: DriveFile): LucideIcon {
  if (f.isFolder) return Folder
  const ct = f.mimeType
  if (ct.startsWith("image/")) return ImageIcon
  if (ct.startsWith("video/")) return Video
  if (ct.startsWith("audio/")) return Music
  return FileText
}

/** Цвет иконки по типу файла — только токены, см. docs/UI_TOKENS.md. */
export function fileIconClass(f: DriveFile) {
  if (f.isFolder) return "text-ws-2"
  const ct = f.mimeType
  if (ct.startsWith("image/")) return "text-ws-out"
  if (ct.startsWith("video/")) return "text-ws-accent"
  if (ct.startsWith("audio/")) return "text-warning"
  return "text-ws-3"
}

export function folderSize(f: DriveFile): number {
  if (!f.isFolder) return f.sizeBytes ?? 0
  return (f.children ?? []).reduce((sum, child) => sum + folderSize(child), 0)
}

/** Подпись под именем: «4 элем. · 15.5 MB» у папки, «2.4 MB · Jul 22, 2026» у файла. */
export function fileMeta(f: DriveFile, t: Dictionary, lang: string) {
  if (f.isFolder) {
    const count = (f.children ?? []).length
    return `${count} ${t.itemsShort} · ${fmtSize(folderSize(f))}`
  }
  return `${fmtSize(f.sizeBytes)} · ${fmtDate(f.modifiedAt ?? f.createdAt, lang)}`
}

export function findChildByName(files: DriveFile[], name: string) {
  const lower = name.toLowerCase()
  return files.find((f) => f.isFolder && f.name.toLowerCase() === lower) ?? null
}

/**
 * Логический путь строкой («IN», «Errors (2026-09-02)/сырьё») → цепочка узлов.
 *
 * Нужен для перехода по ссылке снаружи дерева: индикатор обработки знает, в
 * какой папке лежит файл, но не знает id её узлов — их знает только загруженное
 * дерево. Папки нет — пустая цепочка, то есть корень проекта: файл могли
 * удалить или перенести, и ронять переход из-за этого незачем.
 */
export function resolveFolderPathByName(
  root: DriveFile[],
  folderPath: string,
): DriveFile[] {
  const segments = folderPath.split("/").filter(Boolean)
  const nodes: DriveFile[] = []
  let children = root
  for (const segment of segments) {
    const found = findChildByName(children, segment)
    if (!found) return []
    nodes.push(found)
    children = found.children ?? []
  }
  return nodes
}

export function pathToFolderPath(nodes: DriveFile[]): string {
  return nodes.map((n) => n.name).join("/")
}

export function itemsAtPath(root: DriveFile[], path: DriveFile[]): DriveFile[] {
  return path.length ? (path[path.length - 1].children ?? []) : root
}

/**
 * Файлы (без папок) из той же папки, что и элемент с этим id.
 *
 * Ищем по всему дереву, а не по текущему пути: перелистывание в окне превью
 * нужно и в упрощённом режиме, где у панелей IN / OUT свои локальные пути, и на
 * мобильном — а дерево проекта одно и то же для всех этих видов.
 */
export function siblingFiles(root: DriveFile[], id: string): DriveFile[] {
  const walk = (list: DriveFile[]): DriveFile[] | null => {
    if (list.some((f) => f.id === id)) return list.filter((f) => !f.isFolder)
    for (const f of list) {
      if (!f.isFolder) continue
      const found = walk(f.children ?? [])
      if (found) return found
    }
    return null
  }
  return walk(root) ?? []
}

/** Пере-пройти путь по id после обновления дерева хранилища. */
export function resolvePath(
  root: DriveFile[],
  oldPath: DriveFile[],
): DriveFile[] {
  const next: DriveFile[] = []
  let children = root
  for (const node of oldPath) {
    const found = children.find((c) => c.id === node.id)
    if (!found || !found.isFolder) break
    next.push(found)
    children = found.children ?? []
  }
  return next
}

export function mapProject(raw: Record<string, unknown>): Project {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    groupName: (raw.groupName as Project["groupName"]) ?? "personal",
    isPaused: Boolean(raw.isPaused ?? !raw.isActive),
    isActive: raw.isActive as boolean | undefined,
    isArchived: Boolean(raw.isArchived),
    deletedAt:
      raw.deletedAt == null
        ? null
        : typeof raw.deletedAt === "string"
          ? raw.deletedAt
          : new Date(String(raw.deletedAt)).toISOString(),
    sharedWithMe: Boolean(raw.sharedWithMe),
    memberRole:
      raw.memberRole === "viewer" ||
      raw.memberRole === "editor" ||
      raw.memberRole === "full"
        ? raw.memberRole
        : null,
    driveFolderId: (raw.driveFolderId as string | null) ?? null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    unreadCount: Number(raw.unreadCount ?? 0),
    memberCount: Number(raw.memberCount ?? 0),
  }
}
