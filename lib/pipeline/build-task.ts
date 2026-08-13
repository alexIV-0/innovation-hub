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
 * 2. Ничего машинно-локального. programmPath, folderPath, pathAliases,
 *    localFolder и typeOfFile десктоп подставляет из СВОИХ настроек, у сайта их
 *    нет и быть не может: у каждой машины свои пути к After Effects и ffmpeg.
 *    Эти поля заполняет машина, когда берёт задачу.
 */

export type TaskSourceFile = {
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

export type TaskPayload = {
  schemaVersion: 1
  processingQueue: string[]
  description: Record<string, unknown>
  /** Шаг-источник: его output — найденный файл, а не результат исполнения. */
  mainSearch: Record<string, unknown> & { output: TaskSourceFile[] }
  /** Остальные шаги очереди лежат по своим id. */
  [stepId: string]: unknown
}

export type BuildTaskFailure =
  | "invalid-options"
  | "no-main-search"
  | "no-search-exts"

export type BuildTaskOutcome =
  | { ok: true; payload: TaskPayload; searchExts: string[] }
  | { ok: false; reason: BuildTaskFailure }

/** Расширения из mainSearch — без ведущей точки и в нижнем регистре. */
function normalizeExts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((e) => String(e).trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean)
}

export type SearchExtsOutcome =
  | { ok: true; searchExts: string[] }
  | { ok: false; reason: BuildTaskFailure }

/**
 * Какие типы файлов ищет граф.
 *
 * Отдельно от buildTaskPayload, чтобы сканер отсекал неподходящие файлы до
 * сборки очереди: на проект приходит пачка событий, а обход графа для файла,
 * который всё равно не подойдёт, — работа впустую.
 *
 * Расширения берутся из самого options.json (поле searchExts узла mainSearch).
 * Одного searchType («video») недостаточно: список расширений к нему лежал в
 * настройках десктопного приложения, которых у сайта нет и быть не может.
 */
export function readSearchExts(optionsJson: unknown): SearchExtsOutcome {
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

  const searchExts = normalizeExts(nodeProps(mainSearchNode).searchExts)
  if (searchExts.length === 0) {
    return { ok: false, reason: "no-search-exts" }
  }
  return { ok: true, searchExts }
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
  file: TaskSourceFile
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

  const exts = readSearchExts(graph)
  if (!exts.ok) return { ok: false, reason: exts.reason }
  const searchExts = exts.searchExts

  const steps = createProcessQueue(graph, "mainSearch", input.onWarn)
  if (steps.length === 0) {
    return { ok: false, reason: "no-main-search" }
  }

  const description = buildDescription(nodes)
  description.projectId = input.projectId
  description.projectName = input.projectName
  description.ownerEmail = input.ownerEmail
  description.findTime = input.collectedAt
  description.infoText = `${input.ownerEmail}/${input.projectName}`
  description.curItem = input.file.name
  description.isFolder = false
  description.size = input.file.sizeBytes
  description.folderPath = input.file.folderPath

  const payload: Record<string, unknown> = {
    schemaVersion: 1,
    processingQueue: steps.map((s) => s.id),
    description,
  }
  for (const step of steps) {
    payload[step.id] = step
  }

  // Шаг mainSearch остаётся со своими свойствами, но его output — найденный
  // файл: на десктопе его подставляет поиск по папке, здесь это уже известно.
  const mainStep = (payload.mainSearch ?? {}) as Record<string, unknown>
  payload.mainSearch = { ...mainStep, output: [input.file] }

  return { ok: true, payload: payload as TaskPayload, searchExts }
}

/** Подходит ли файл под типы, которые ищет граф. */
export function matchesSearchExts(name: string, exts: string[]): boolean {
  const dot = name.lastIndexOf(".")
  if (dot < 0) return false
  const ext = name.slice(dot + 1).toLowerCase()
  return exts.includes(ext)
}
