/**
 * Правило чтения папки `OUT` — у каждого проекта своё.
 *
 * Раскладку `OUT` настраивает граф обработки, и она может быть любой: у одного
 * проекта задача — это папка первого уровня, у другого задачи разложены по
 * клиентам, у третьего в корне лежат готовые `*.srt`. Поэтому правило не общая
 * настройка инструмента, а свойство пары «инструмент — проект» и живёт в
 * `user_tools.settings.projectRules` (§8, §9 плана).
 */

import type { ToolInstance } from "../tools-context"

export type ProjectRule =
  /** Папки первого уровня внутри `OUT` — раскладка по умолчанию. */
  | "folders"
  /** Папки второго уровня: `OUT/{клиент}/{задача}`. */
  | "folders2"
  /** Искать задачи самим: папка с `dialog.json` или с папками дорожек. */
  | "auto"
  /** Только файлы `*.srt` в корне `OUT`. */
  | "srt"
  /** Всё содержимое корня `OUT`: и папки, и файлы. */
  | "flat"

export type ProjectRuleValue = { rule: ProjectRule }

export const DEFAULT_PROJECT_RULE: ProjectRuleValue = { rule: "folders" }

/** Глубже не спускаемся: дальше начинаются папки дорожек и их содержимое. */
const MAX_DEPTH = 3

export function projectRules(tool: ToolInstance) {
  const raw = tool.settings?.projectRules
  const all: Record<string, ProjectRuleValue> =
    raw && typeof raw === "object" ? (raw as Record<string, ProjectRuleValue>) : {}
  return {
    all,
    for: (projectId: string): ProjectRuleValue => ({
      ...DEFAULT_PROJECT_RULE,
      // В настройках раньше хранилась ещё и сортировка; лишние ключи не мешают —
      // читается только `rule`.
      ...(all[projectId] ?? {}),
    }),
  }
}

export type TreeEntry = {
  name: string
  folderPath: string
  isFolder: boolean
  modifiedAt?: string | null
}

/** Путь внутри корня: `OUT/Клиент/Задача` при корне `OUT` → `Клиент/Задача`. */
function relativeTo(root: string, folderPath: string, name: string): string | null {
  const full = [folderPath, name].filter(Boolean).join("/")
  if (root === "") return full
  if (full === root) return ""
  return full.startsWith(`${root}/`) ? full.slice(root.length + 1) : null
}

/**
 * Папки, похожие на задачу: внутри лежит документ или папки дорожек.
 *
 * Признак второй именно такой — **подпапка** с титрами. Папка, в которой `.srt`
 * лежит сама, это дорожка, а не задача, и предложить её человеку значило бы
 * открыть половину материала как целое.
 */
function autoTasks(entries: TreeEntry[], root: string): string[] {
  const withDoc = new Set<string>()
  const withTrackFolder = new Set<string>()

  for (const entry of entries) {
    if (entry.isFolder) continue
    const rel = relativeTo(root, entry.folderPath, "")
    if (rel === null) continue
    if (entry.name === "dialog.json" && rel !== "") withDoc.add(rel)
    if (/\.srt$/i.test(entry.name) && rel.includes("/")) {
      // Титры в `A/B` делают задачей `A`, а дорожкой — `B`.
      withTrackFolder.add(rel.slice(0, rel.lastIndexOf("/")))
    }
  }

  return [...new Set([...withDoc, ...withTrackFolder])].filter(
    (rel) => rel !== "" && rel.split("/").length <= MAX_DEPTH,
  )
}

/** Папки ровно на заданной глубине от корня. */
function foldersAtDepth(entries: TreeEntry[], root: string, depth: number): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (!entry.isFolder) continue
    const rel = relativeTo(root, entry.folderPath, entry.name)
    if (rel && rel.split("/").length === depth) out.push(rel)
  }
  return out
}

/**
 * Что показать в подменю проекта — пути задач относительно корня.
 *
 * Всегда по алфавиту: сортировка по дате была лишним переключателем — у папок
 * задач дата меняется от любой записи внутри, и порядок от неё скакал бы, ничего
 * не сообщая.
 */
export function taskItems(
  entries: TreeEntry[],
  root: string,
  value: ProjectRuleValue,
): string[] {
  const picked = (() => {
    switch (value.rule) {
      case "folders":
        return foldersAtDepth(entries, root, 1)
      case "folders2":
        return foldersAtDepth(entries, root, 2)
      case "auto":
        return autoTasks(entries, root)
      case "srt":
        return entries
          .filter((e) => !e.isFolder && e.folderPath === root && /\.srt$/i.test(e.name))
          .map((e) => e.name)
      default:
        return entries
          .filter((e) => e.folderPath === root)
          .map((e) => e.name)
    }
  })()

  return [...new Set(picked)].sort((a, b) => a.localeCompare(b))
}
