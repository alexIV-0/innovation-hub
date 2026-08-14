import { query } from "@/lib/db"
import {
  SETTINGS_DOMAINS,
  isSettingsDomain,
  type SettingsDocument,
  type SettingsDomain,
  type SettingsDomains,
  type SettingsEntry,
} from "@/lib/settings-types"

/**
 * Общие словари: типы файлов с расширениями, цвета типов нод и типов данных,
 * пользовательские маски путей. Контракт и обоснование — docs/SETTINGS_SYNC.md.
 *
 * Единственное место, где живут правила чтения/записи. Три поверхности
 * (`/api/storage/v1/settings` для десктопа, экшены на `POST /api/v1` для машин
 * конвейера, `/api/admin/settings` для браузера) — тонкие обёртки над этим
 * файлом; иначе проверка ревизии и нормализация разъедутся между ними.
 *
 * Типы и список доменов — в lib/settings-types.ts: их же импортируют клиентские
 * компоненты, а отсюда в бандл уехал бы `pg`.
 */

export type {
  SettingsDocument,
  SettingsDomain,
  SettingsDomains,
  SettingsEntry,
}
export { SETTINGS_DOMAINS, isSettingsDomain }

export type WriteResult =
  | { ok: true; document: SettingsDocument }
  | { ok: false; reason: "revision-conflict"; document: SettingsDocument }

export class SettingsValidationError extends Error {}

const SINGLETON = "singleton"

// ─── Нормализация ────────────────────────────────────────────────────────────

/**
 * Цвета в десктопе записаны в двух форматах: `#0a84feff` (8-значный hex с альфой)
 * и `rgb(99, 214, 81)` у xlsx, posting, scripts. Храним один — `#rrggbb` или
 * `#rrggbbaa`, — иначе UI придётся разбирать оба, и сравнение при слиянии
 * ("цвет не менялся") будет ложно срабатывать на одном и том же цвете.
 */
export function normalizeColor(raw: unknown): string | null {
  if (raw == null) return null
  const value = String(raw).trim().toLowerCase()
  if (!value) return null

  const hex = /^#([0-9a-f]{3,8})$/.exec(value)
  if (hex) {
    const digits = hex[1]
    if (digits.length === 3) {
      const [r, g, b] = digits
      return `#${r}${r}${g}${g}${b}${b}`
    }
    if (digits.length === 6 || digits.length === 8) {
      // Полностью непрозрачный цвет храним без альфы: #0a84feff и #0a84fe — одно и то же.
      return digits.length === 8 && digits.endsWith("ff")
        ? `#${digits.slice(0, 6)}`
        : `#${digits}`
    }
    throw new SettingsValidationError(`Unsupported color format: ${raw}`)
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(value)
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => p.trim())
    if (parts.length !== 3 && parts.length !== 4) {
      throw new SettingsValidationError(`Unsupported color format: ${raw}`)
    }
    const channels = parts.slice(0, 3).map((p) => {
      const n = Number(p)
      if (!Number.isFinite(n) || n < 0 || n > 255) {
        throw new SettingsValidationError(`Unsupported color format: ${raw}`)
      }
      return Math.round(n).toString(16).padStart(2, "0")
    })
    const alpha = parts.length === 4 ? Number(parts[3]) : 1
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
      throw new SettingsValidationError(`Unsupported color format: ${raw}`)
    }
    const alphaHex =
      alpha >= 1 ? "" : Math.round(alpha * 255).toString(16).padStart(2, "0")
    return `#${channels.join("")}${alphaHex}`
  }

  throw new SettingsValidationError(`Unsupported color format: ${raw}`)
}

/** Расширения — без ведущей точки и в нижнем регистре, как в readSearchExts. */
function normalizePath(domain: SettingsDomain, raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const items = raw
    .map((item) => String(item).trim())
    .filter(Boolean)
    .map((item) =>
      domain === "fileType" ? item.toLowerCase().replace(/^\./, "") : item,
    )
  // Дубли внутри одного типа бессмысленны и ломают объединение при слиянии.
  return [...new Set(items)]
}

function normalizeEntry(domain: SettingsDomain, raw: unknown): SettingsEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsValidationError("Entry must be an object.")
  }
  const source = raw as Record<string, unknown>
  const name = String(source.name ?? "").trim()
  if (!name) {
    throw new SettingsValidationError("Entry name is required.")
  }
  if (name.length > 64) {
    throw new SettingsValidationError(`Entry name is too long: ${name}`)
  }
  return {
    name,
    path: normalizePath(domain, source.path),
    color: normalizeColor(source.color),
    isDefault: source.isDefault === true,
  }
}

/**
 * Приводит присланный домен к каноничному виду и отбивает дубли по имени.
 *
 * Имя — ключ: два `video` в одном домене сделали бы слияние недетерминированным
 * (какой из них «тот же самый»?), поэтому это ошибка запроса, а не тихое
 * схлопывание.
 */
export function normalizeDomain(
  domain: SettingsDomain,
  raw: unknown,
): SettingsEntry[] {
  if (!Array.isArray(raw)) {
    throw new SettingsValidationError(`Domain ${domain} must be an array.`)
  }
  const entries = raw.map((item) => normalizeEntry(domain, item))
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      throw new SettingsValidationError(
        `Duplicate entry name in ${domain}: ${entry.name}`,
      )
    }
    seen.add(entry.name)
  }
  return entries
}

export function normalizeDomains(raw: unknown): SettingsDomains {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsValidationError("domains must be an object.")
  }
  const result: SettingsDomains = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSettingsDomain(key)) {
      throw new SettingsValidationError(`Unknown settings domain: ${key}`)
    }
    result[key] = normalizeDomain(key, value)
  }
  return result
}

// ─── Дефолты ─────────────────────────────────────────────────────────────────

/**
 * Порт дефолтов десктопа (pathPattern_store.ts, defaultFileTypes /
 * defaultNodeType / defaultTypeData). Цвета приведены к одному формату
 * функцией normalizeColor при сидировании.
 *
 * `ffplay` в defaultNodeType закомментирован и лежит в COLOR_TYPE_EXCLUDED —
 * в сид не идёт.
 *
 * programPath и folderPath отсутствуют намеренно: там пути к ffmpeg и After
 * Effects, они машинно-локальные и не синхронизируются вовсе (PIPELINE.md §5).
 */
export const DEFAULT_DOMAINS: Record<SettingsDomain, SettingsEntry[]> = {
  fileType: [
    { name: "video", color: "#0a84fe", isDefault: true, path: ["avi", "mov", "mp4", "mpeg", "mpg", "m2v", "m4v", "ts", "mxf", "mkv"] },
    { name: "audio", color: "#ffae0c", isDefault: true, path: ["mp3", "wav"] },
    { name: "image", color: "#00e308", isDefault: true, path: ["jpg", "jpeg", "png", "tiff", "tga", "pdf", "gif", "pgf"] },
    { name: "text", color: "#90bae5", isDefault: true, path: ["txt", "json"] },
    { name: "title", color: "#9be590", isDefault: true, path: ["lrc", "srt"] },
    { name: "xlsx", color: "#63d651", isDefault: true, path: ["tsv", "csv"] },
    { name: "aep", color: "#9857ff", isDefault: true, path: ["aep"] },
    { name: "moho", color: "#b20aff", isDefault: true, path: ["moho"] },
    { name: "scripts", color: "#0032c8", isDefault: true, path: ["js", "jsx", "lua"] },
  ],
  nodeType: [
    { name: "main", color: "#2bea1d", isDefault: true, path: [] },
    { name: "helpers", color: "#efe708", isDefault: true, path: [] },
    { name: "ffmpeg", color: "#9d2dff", isDefault: true, path: [] },
    { name: "afterEffect", color: "#502dff", isDefault: true, path: [] },
    { name: "moho", color: "#ff2d9d", isDefault: true, path: [] },
    { name: "ai", color: "#2d84ff", isDefault: true, path: [] },
    { name: "ffprobe", color: "#6900c5", isDefault: true, path: [] },
    { name: "posting", color: "#5181b8", isDefault: true, path: [] },
  ],
  dataType: [
    { name: "folders", color: "#e00000", isDefault: true, path: [] },
    { name: "files", color: "#838bff", isDefault: true, path: [] },
    { name: "path", color: "#005903", isDefault: true, path: [] },
    { name: "timecode", color: "#5a0000", isDefault: true, path: [] },
    { name: "string", color: "#16668a", isDefault: true, path: [] },
  ],
  // Целиком пользовательский домен — дефолтов нет.
  pathPattern: [],
}

// ─── Чтение и запись ─────────────────────────────────────────────────────────

type Row = { revision: string; domains: unknown }

function mapRow(row: Row): SettingsDocument {
  const raw =
    row.domains && typeof row.domains === "object" && !Array.isArray(row.domains)
      ? (row.domains as Record<string, unknown>)
      : {}
  const domains: SettingsDomains = {}
  for (const domain of SETTINGS_DOMAINS) {
    // Домен, которого нет в документе, отдаём пустым массивом, а не undefined:
    // клиенту важно отличать «домен пуст» от «домен не запрашивался», а этот
    // ответ всегда про запрошенные.
    domains[domain] = Array.isArray(raw[domain])
      ? normalizeDomain(domain, raw[domain])
      : []
  }
  return { revision: Number(row.revision), domains }
}

function pickDomains(
  document: SettingsDocument,
  only?: SettingsDomain[],
): SettingsDocument {
  if (!only || only.length === 0) return document
  const domains: SettingsDomains = {}
  for (const domain of only) domains[domain] = document.domains[domain] ?? []
  return { revision: document.revision, domains }
}

async function readRow(): Promise<SettingsDocument> {
  const result = await query<Row>(
    `SELECT revision::text, domains FROM automation_settings WHERE id = $1`,
    [SINGLETON],
  )
  const row = result.rows[0]
  // Строку создаёт миграция; её отсутствие — незалитая миграция, а не пустые
  // настройки. Молчать нельзя: клиент получит «словарь пуст» и решит, что все
  // типы удалены.
  if (!row) {
    throw new Error(
      "automation_settings row is missing — run npm run db:migrate.",
    )
  }
  return mapRow(row)
}

/** Документ настроек. `only` — вернуть лишь эти домены. */
export async function readSettings(
  only?: SettingsDomain[],
): Promise<SettingsDocument> {
  return pickDomains(await readRow(), only)
}

/**
 * Словарь типов файлов в форме, которой пользуется обработка:
 * `{ "video": ["mp4", "mov"], … }` — как `typeOfFile` в десктопе.
 *
 * Нужен сборщику задач как запасной путь: у проектов, сохранённых до появления
 * снимка `fileTypes` в options.json, развернуть `searchType` больше нечем
 * (fs.manager.tauri/ideasAndTest/PIPELINE_BACKEND_REQUESTS.md §1). Иначе всем
 * старым проектам пришлось бы вручную пересохранять граф.
 */
export async function readFileTypeDictionary(): Promise<Record<string, string[]>> {
  const document = await readSettings(["fileType"])
  const out: Record<string, string[]> = {}
  for (const entry of document.domains.fileType ?? []) {
    out[entry.name] = entry.path
  }
  return out
}

/**
 * Только ревизия. Нужна для `delta`: десктоп дёргает его каждые 3 секунды, и
 * тащить туда весь документ ради сравнения счётчика было бы расточительно.
 */
export async function readSettingsRevision(): Promise<number> {
  const result = await query<{ revision: string }>(
    `SELECT revision::text FROM automation_settings WHERE id = $1`,
    [SINGLETON],
  )
  return result.rows[0] ? Number(result.rows[0].revision) : 0
}

/**
 * Запись с оптимистической блокировкой.
 *
 * Домены, не перечисленные в `domains`, не трогаются — можно послать только
 * fileType, не зная и не перетирая остальные.
 *
 * Ноль обновлённых строк означает, что ревизия уехала: отдаём текущее состояние,
 * чтобы клиент слил три стороны (docs/SETTINGS_SYNC.md §5) и повторил. Слияние
 * делает клиент, а не сервер: только у клиента есть база — снимок на момент
 * последней успешной синхронизации, — без которой «кто что менял» неразличимо.
 */
export async function writeSettings(input: {
  baseRevision: number
  // Сырой вход: нормализация (цвета, расширения, дубли) — часть контракта записи,
  // поэтому вызывающему не нужно готовить каноничные записи самому.
  domains: unknown
  updatedBy?: string | null
}): Promise<WriteResult> {
  const patch = normalizeDomains(input.domains)

  const result = await query<Row>(
    `UPDATE automation_settings
        SET domains    = domains || $2::jsonb,
            revision   = revision + 1,
            updated_at = NOW(),
            updated_by = $3
      WHERE id = $1
        AND revision = $4
      RETURNING revision::text, domains`,
    [SINGLETON, JSON.stringify(patch), input.updatedBy ?? null, input.baseRevision],
  )

  const row = result.rows[0]
  if (!row) {
    return {
      ok: false,
      reason: "revision-conflict",
      document: await readRow(),
    }
  }
  return { ok: true, document: mapRow(row) }
}

/**
 * Наливает дефолты в домены, которых в документе ещё нет.
 *
 * Идемпотентно и неразрушающе: домен, где уже что-то лежит, не трогается вовсе —
 * иначе повторный вызов затирал бы пользовательские правки дефолтами. Поэтому
 * дефолты живут здесь, а не в миграции: рядом с нормализацией цветов и в одном
 * экземпляре.
 */
export async function seedDefaultSettings(): Promise<{
  seeded: SettingsDomain[]
  document: SettingsDocument
}> {
  const current = await readRow()
  const patch: SettingsDomains = {}
  const seeded: SettingsDomain[] = []

  for (const domain of SETTINGS_DOMAINS) {
    const existing = current.domains[domain] ?? []
    const defaults = DEFAULT_DOMAINS[domain]
    if (existing.length > 0 || defaults.length === 0) continue
    patch[domain] = defaults.map((entry) => ({
      ...entry,
      color: normalizeColor(entry.color),
    }))
    seeded.push(domain)
  }

  if (seeded.length === 0) return { seeded, document: current }

  const written = await writeSettings({
    baseRevision: current.revision,
    domains: patch,
  })
  // Конфликт здесь означает параллельный сид; повторять не нужно — второй
  // писатель уже налил то же самое.
  return { seeded, document: written.document }
}
