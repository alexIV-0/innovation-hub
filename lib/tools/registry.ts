/**
 * Каталог инструментов — единственный источник правды о том, что можно добавить
 * себе в разделе «Инструменты».
 *
 * Почему код, а не таблица: у инструмента есть интерфейс, поэтому появление
 * нового — это всё равно деплой. Таблица добавила бы второй источник правды и
 * состояние «запись есть, кода нет».
 *
 * Имена и описания живут в словаре (`components/account/i18n.tsx`) по ключам
 * `tool_<key>_name`, `tool_<key>_short`, `tool_<key>_long` — здесь только то,
 * что не зависит от языка. Иконка — строковый ключ: этот модуль читают и
 * серверные роуты, тащить в них компоненты незачем.
 */

/** Тип материала. Из него собираются теги-фильтры в каталоге. */
export type ToolKind = "srt" | "text" | "video" | "image" | "audio" | "data"

export const TOOL_KINDS: ToolKind[] = ["srt", "video", "audio", "text", "image", "data"]

export type ToolDefinition = {
  /** Стабильный ключ: попадает в БД, менять нельзя. */
  key: string
  kinds: ToolKind[]
  /** Ключ иконки; сопоставление с компонентом — в components/account/tools/icons.ts */
  icon: string
  /** `soon` — показываем в каталоге, но добавить нельзя. */
  status: "ready" | "soon"
  /** Настройки экземпляра при добавлении. */
  defaults: Record<string, unknown>
}

export const TOOLS: ToolDefinition[] = [
  {
    key: "srt-editor",
    kinds: ["srt", "video", "audio"],
    icon: "captions",
    status: "ready",
    defaults: {
      /** Папка проекта, откуда берём задачи. */
      sourceRoot: "OUT",
      /** Проекты, которые не показывать в выпадающем списке (id). */
      hiddenProjectIds: [],
      /** Экспортировать при каждом сохранении документа. */
      autoExport: true,
      /** Интервал автосохранения, мс. */
      autosaveMs: 15000,
    },
  },
  {
    key: "voice-over",
    kinds: ["audio", "srt"],
    icon: "mic",
    status: "soon",
    defaults: {},
  },
]

export function findTool(key: string): ToolDefinition | null {
  return TOOLS.find((t) => t.key === key) ?? null
}
