import {
  createProcessQueue,
  nodeProps,
  type FlowNode,
  type Graph,
} from "@/lib/pipeline/process-queue"

/**
 * options.json → объект для обработки.
 *
 * Форма повторяет то, что собирает десктоп в
 * src/PROCESSING/findFilesForSingleFolder.ts: processingQueue со списком id,
 * сами шаги по ключам, mainSearch с найденным элементом и description с
 * контекстом проекта.
 *
 * Два отличия, и оба обязательны, потому что здесь оркестратор, а не исполнитель:
 *
 * 1. Никаких ссылок и никаких путей. Presigned URL живёт минуты, а задача может
 *    простоять в очереди часы и переретраиться на следующий день — приедет с
 *    мёртвой ссылкой. Вместо пути в mainSearch лежит идентичность файла, байты
 *    машина получает экшеном presign, когда действительно начинает работу.
 *
 * 2. Почти ничего машинно-локального. programmPath, folderPath, pathAliases и
 *    localFolder десктоп подставляет из СВОИХ настроек: у каждой машины свои
 *    пути к After Effects и ffmpeg. Эти поля заполняет машина.
 *
 *    Исключение — typeOfFile. После синхронизации словарей (docs/SETTINGS_SYNC.md)
 *    он перестал быть свойством машины и стал общей конвенцией, поэтому его
 *    кладёт сюда сайт: иначе две машины развернули бы один searchType по-разному.
 */

/** Словарь `{ "video": ["mp4", "mov"], … }` — то же, что typeOfFile в десктопе. */
export type FileTypeDictionary = Record<string, string[]>

export type TaskSourceEntry = {
  /** id строки project_files; у служебных файлов его нет. */
  fileId: string | null
  /** Ключ в объектном хранилище — стабильная идентичность. */
  s3Key: string
  name: string
  /** Логический путь от корня проекта, например IN или IN/raw. */
  folderPath: string
  sizeBytes: number
  contentHash: string | null
}

/**
 * Источник витка обработки — ОДИН элемент в IN: файл или папка.
 *
 * Для папки перечисление содержимого делается один раз, в момент снятия `-` с
 * имени: до этого папку наполняют, после — она заморожена, поэтому манифест не
 * устаревает. Машина разворачивает папку в scratch целиком и дальше работает как
 * при локальной обработке.
 */
export type TaskSourceFolder = TaskSourceEntry & {
  isFolder: true
  children: TaskSourceEntry[]
}

export type TaskSource = TaskSourceEntry | TaskSourceFolder

export function isFolderSource(source: TaskSource): source is TaskSourceFolder {
  return (source as TaskSourceFolder).isFolder === true
}

/** @deprecated историческое имя; осталось, чтобы не ломать импорты. */
export type TaskSourceFile = TaskSourceEntry

export type TaskPayload = {
  schemaVersion: 1
  processingQueue: string[]
  description: Record<string, unknown>
  /** Шаг-источник: его output — найденный элемент, а не результат исполнения. */
  mainSearch: Record<string, unknown> & { output: TaskSource[] }
  /** Остальные шаги очереди лежат по своим id. */
  [stepId: string]: unknown
}

export type BuildTaskFailure =
  | "invalid-options"
  | "no-main-search"
  | "no-search-type"
  | "unknown-search-type"
  | "no-search-exts"

export type BuildTaskOutcome =
  | { ok: true; payload: TaskPayload; searchExts: string[] }
  | { ok: false; reason: BuildTaskFailure }

/** Расширения — без ведущей точки и в нижнем регистре. */
function normalizeExts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => String(e).trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
}

export type SearchExtsOutcome =
  | {
      ok: true
      searchExts: string[]
      searchType: string | null
      /** Словарь, которым разворачивался тип: он же уезжает в description. */
      fileTypes: FileTypeDictionary
    }
  | { ok: false; reason: BuildTaskFailure }

/**
 * Снимок словаря типов из самого графа.
 *
 * Программа пишет его соседним ключом рядом с nodes/edges при каждом сохранении
 * (PIPELINE_BACKEND_REQUESTS.md §1). Снимок, а не ссылка на общий словарь:
 * задача обязана быть воспроизводимой тем графом, каким её нарисовали, иначе
 * правка настройки молча меняет поведение старых проектов.
 */
export function readFileTypesSnapshot(
  optionsJson: unknown,
): FileTypeDictionary | null {
  if (!optionsJson || typeof optionsJson !== "object") return null
  const raw = (optionsJson as Record<string, unknown>).fileTypes
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null

  const out: FileTypeDictionary = {}
  for (const [name, exts] of Object.entries(raw as Record<string, unknown>)) {
    const list = normalizeExts(exts)
    if (list.length > 0) out[name] = list
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * Какие типы файлов ищет граф.
 *
 * Отдельно от buildTaskPayload, чтобы сканер отсекал неподходящие файлы до
 * сборки очереди: на проект приходит пачка событий, а обход графа для файла,
 * который всё равно не подойдёт, — работа впустую.
 *
 * Порядок источников расширений:
 *
 * 1. `searchExts` прямо в узле — если программа его проставила, доверяем как есть;
 * 2. `searchType` + снимок `fileTypes` из того же options.json — основной путь;
 * 3. `searchType` + синхронизированный словарь (`fallback`) — для проектов,
 *    сохранённых до появления снимка. Без него у них не было бы вообще ничего,
 *    и каждый пришлось бы открывать и пересохранять руками.
 *
 * Словарь нужен целиком, а не только расширения одного типа: граф уходит в другие
 * папки за аудио, текстом, скриптами, и плагины читают весь `typeOfFile`.
 */
export function readSearchExts(
  optionsJson: unknown,
  fallback: FileTypeDictionary = {},
): SearchExtsOutcome {
  if (!optionsJson || typeof optionsJson !== "object" || Array.isArray(optionsJson)) {
    return { ok: false, reason: "invalid-options" }
  }

  const nodes = (optionsJson as Graph).nodes
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { ok: false, reason: "invalid-options" }
  }

  const mainSearchNode = nodes.find((n) => n.id.toLowerCase() === "mainsearch")
  // Выключенный mainSearch — это пауза обработки на уровне графа: источника нет,
  // значит и элементов нет.
  if (!mainSearchNode || mainSearchNode.data?.disabled === true) {
    return { ok: false, reason: "no-main-search" }
  }

  const snapshot = readFileTypesSnapshot(optionsJson)
  // Снимок главнее: он описывает граф на момент сохранения. Общий словарь
  // подмешиваем под него — так у проекта появляются типы, которых в снимке нет,
  // но и снимок не переопределяется задним числом.
  const fileTypes: FileTypeDictionary = { ...fallback, ...(snapshot ?? {}) }

  const props = nodeProps(mainSearchNode)

  const explicit = normalizeExts(props.searchExts)
  if (explicit.length > 0) {
    const searchType =
      typeof props.searchType === "string" ? props.searchType : null
    return { ok: true, searchExts: explicit, searchType, fileTypes }
  }

  const searchType =
    typeof props.searchType === "string" && props.searchType.trim()
      ? props.searchType.trim()
      : null
  if (!searchType) {
    return { ok: false, reason: "no-search-type" }
  }

  const searchExts = normalizeExts(fileTypes[searchType])
  if (searchExts.length === 0) {
    // Тип есть, а расширений к нему нет ни в снимке, ни в общем словаре:
    // либо тип переименовали, либо из него убрали все расширения.
    return {
      ok: false,
      reason:
        Object.keys(fileTypes).length === 0
          ? "no-search-exts"
          : "unknown-search-type",
    }
  }
  return { ok: true, searchExts, searchType, fileTypes }
}

/**
 * Контекст проекта, который получает каждый шаг — порт getDesription.ts.
 *
 * Узел description необязателен: без него обработка возможна, просто в контексте
 * не будет ни контакта, ни комментария автора.
 */
function buildDescription(nodes: FlowNode[]): Record<string, unknown> {
  const descriptionNode = nodes.find((n) => n.id.toLowerCase() === "description")

  const contact = descriptionNode?.data?.properties?.find(
    (p) => p.id.toLowerCase() === "contact",
  )?.controlProps?.value

  // Ноды раскраски main/helpers — это не шаги обработки, в тип автоматизации
  // они не входят.
  const excluded = new Set(["main", "helpers"])
  const automationType = [
    ...new Set(
      nodes
        .filter((n) => !excluded.has(String(n.data?.colorType ?? "")))
        .map((n) => n.data?.pluginId)
        .filter((id): id is string => Boolean(id)),
    ),
  ]

  return {
    contact,
    automationType,
    discription: descriptionNode?.data?.comment,
  }
}

export function buildTaskPayload(input: {
  optionsJson: unknown
  projectId: string
  projectName: string
  ownerEmail: string
  /** Один элемент папки IN: файл или папка с манифестом содержимого. */
  source: TaskSource
  /** Словарь типов, которым разворачивался searchType — уедет в description. */
  fileTypes?: FileTypeDictionary
  /** ISO-время сборки: на десктопе это findTime, метка прогона. */
  collectedAt: string
  onWarn?: (message: string) => void
}): BuildTaskOutcome {
  const root = input.optionsJson
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    return { ok: false, reason: "invalid-options" }
  }

  const graph = root as Graph
  const nodes = graph.nodes ?? []

  const exts = readSearchExts(graph, input.fileTypes)
  if (!exts.ok) return { ok: false, reason: exts.reason }
  const searchExts = exts.searchExts

  const steps = createProcessQueue(graph, "mainSearch", input.onWarn)
  if (steps.length === 0) {
    return { ok: false, reason: "no-main-search" }
  }

  const source = input.source
  const isFolder = isFolderSource(source)

  const description = buildDescription(nodes)
  description.projectId = input.projectId
  description.projectName = input.projectName
  description.ownerEmail = input.ownerEmail
  description.findTime = input.collectedAt
  description.infoText = `${input.ownerEmail}/${input.projectName}`
  description.curItem = source.name
  description.isFolder = isFolder
  description.folderPath = source.folderPath
  // Для папки размер — сумма по содержимому: у самой папки в хранилище его нет.
  description.size = isFolder
    ? source.children.reduce((sum, child) => sum + child.sizeBytes, 0)
    : source.sizeBytes
  // Общая конвенция, а не свойство машины — см. шапку файла.
  description.typeOfFile = exts.fileTypes
  description.searchType = exts.searchType

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    processingQueue: steps.map((s) => s.id),
    description,
  }
  for (const step of steps) {
    payload[step.id] = step
  }

  // Шаг mainSearch остаётся со своими свойствами, но его output — найденный
  // элемент: на десктопе его подставляет поиск по папке, здесь это уже известно.
  const mainStep = (payload.mainSearch ?? {}) as Record<string, unknown>
  payload.mainSearch = { ...mainStep, output: [source] }

  return { ok: true, payload: payload as TaskPayload, searchExts }
}

/** Подходит ли файл под типы, которые ищет граф. */
export function matchesSearchExts(name: string, exts: string[]): boolean {
  const dot = name.lastIndexOf(".")
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return exts.includes(ext)
}
