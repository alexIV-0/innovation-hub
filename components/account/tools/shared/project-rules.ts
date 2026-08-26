/**
 * Правило чтения папки `OUT` — у каждого проекта своё.
 *
 * Раскладку `OUT` настраивает граф обработки, и она может быть любой: у одного
 * проекта задача — это папка, у другого в корне лежат готовые `*.srt`. Поэтому
 * правило не общая настройка инструмента, а свойство пары «инструмент —
 * проект» и живёт в `user_tools.settings.projectRules` (§8, §9 плана).
 */

import type { ToolInstance } from "../tools-context"

export type ProjectRule =
  /** Папки первого уровня внутри `OUT` — раскладка по умолчанию. */
  | "folders"
  /** Только файлы `*.srt` в корне `OUT`. */
  | "srt"
  /** Всё содержимое корня `OUT`: и папки, и файлы. */
  | "flat"

export type ProjectSort = "name" | "date"

export type ProjectRuleValue = { rule: ProjectRule; sort: ProjectSort }

export const DEFAULT_PROJECT_RULE: ProjectRuleValue = { rule: "folders", sort: "name" }

export function projectRules(tool: ToolInstance) {
  const raw = tool.settings?.projectRules
  const all: Record<string, ProjectRuleValue> =
    raw && typeof raw === "object" ? (raw as Record<string, ProjectRuleValue>) : {}
  return {
    all,
    for: (projectId: string): ProjectRuleValue => ({
      ...DEFAULT_PROJECT_RULE,
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

/** Что показать в подменю проекта: элементы корня `root` по правилу. */
export function taskItems(
  entries: TreeEntry[],
  root: string,
  value: ProjectRuleValue,
): string[] {
  // Только прямые вложения корня: задача, а не то, что внутри неё.
  const own = entries.filter((entry) => entry.folderPath === root)
  const picked = own.filter((entry) => {
    if (value.rule === "folders") return entry.isFolder
    if (value.rule === "srt") return !entry.isFolder && /\.srt$/i.test(entry.name)
    return true
  })
  const sorted = picked.slice().sort((a, b) => {
    if (value.sort === "date") {
      const at = Date.parse(a.modifiedAt ?? "") || 0
      const bt = Date.parse(b.modifiedAt ?? "") || 0
      if (at !== bt) return bt - at
    }
    return a.name.localeCompare(b.name)
  })
  return sorted.map((entry) => entry.name)
}
