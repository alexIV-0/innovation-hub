/**
 * Типы и константы общих словарей — без обращений к базе.
 *
 * Отдельным файлом, потому что их импортируют и серверный репозиторий, и
 * клиентские компоненты. Лежи они в repositories/automation-settings.ts, любой
 * импорт значения (не типа) из клиента утянул бы в бандл `pg`.
 *
 * Смысл полей и правила синхронизации — docs/SETTINGS_SYNC.md.
 */

export const SETTINGS_DOMAINS = [
  "fileType",
  "nodeType",
  "dataType",
  "pathPattern",
] as const

export type SettingsDomain = (typeof SETTINGS_DOMAINS)[number]

/**
 * Запись словаря — порт `PatternElement` из десктопа, но без `id` и
 * `inactivePath`.
 *
 * `id` не хранится намеренно: у дефолтов он человекочитаемый (`video`), у
 * пользовательских — nanoid, то есть на второй машине будет другой. Идентичность
 * во всей системе и так по имени: графы ссылаются на тип как `searchType:
 * "video"`, getFileTypeByExt ключует по имени, десктоп сливает дефолты по имени.
 *
 * `path` значит разное в разных доменах: расширения у fileType, сегменты маски у
 * pathPattern, у остальных пуст.
 */
export type SettingsEntry = {
  name: string
  path: string[]
  color: string | null
  isDefault: boolean
}

/**
 * Домен — массив, а не объект: порядок значим. getFileTypeByExt возвращает
 * ПЕРВОЕ совпадение, поэтому расширение, попавшее в два типа, достаётся верхнему.
 */
export type SettingsDomains = Partial<Record<SettingsDomain, SettingsEntry[]>>

export type SettingsDocument = {
  revision: number
  domains: SettingsDomains
}

export function isSettingsDomain(value: string): value is SettingsDomain {
  return (SETTINGS_DOMAINS as readonly string[]).includes(value)
}

/**
 * Ключи подписей для UI. Сами тексты живут в components/admin/admin-dict.ts:
 * они переводятся, а этот файл про переводы не знает и знать не должен — его
 * импортирует и серверный репозиторий.
 *
 * `pathLabel: null` — у домена нет списка `path`, строку с чипсами показывать
 * незачем.
 */
export const DOMAIN_LABELS: Record<
  SettingsDomain,
  { title: string; hint: string; pathLabel: string | null }
> = {
  fileType: {
    title: "settingsDomainFileType",
    hint: "settingsDomainFileTypeHint",
    pathLabel: "settingsPathLabelExtensions",
  },
  nodeType: {
    title: "settingsDomainNodeType",
    hint: "settingsDomainNodeTypeHint",
    pathLabel: null,
  },
  dataType: {
    title: "settingsDomainDataType",
    hint: "settingsDomainDataTypeHint",
    pathLabel: null,
  },
  pathPattern: {
    title: "settingsDomainPathPattern",
    hint: "settingsDomainPathPatternHint",
    pathLabel: "settingsPathLabelSegments",
  },
}
