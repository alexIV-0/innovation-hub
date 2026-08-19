/**
 * Формат числовых контролов (`slider`, `valueRange`) — порт
 * `fs.manager.tauri/src/Utils/numericFormat.ts`.
 *
 * Дублирование осознанное — ровно как у [process-queue.ts](../pipeline/process-queue.ts),
 * и по той же причине: сайт и программа читают один и тот же `options.json`, и
 * если округление, шаг или разбор таймкода разойдутся, пользователь увидит на
 * сайте одно число, а в обработку уйдёт другое. Расхождение всплывёт не сразу.
 * Меняется что-то здесь — меняется и там.
 *
 * ЕДИНИЦЫ ХРАНЕНИЯ ТАЙМКОДА — всегда СЕКУНДЫ: в `controlProps.value` лежит
 * число, его читает рантайм плагина. `HH:MM:SS` — только показ и ввод.
 */

export type NumericFormat = "timecode" | "float" | "integer" | "auto"

const NUMERIC_FORMATS: readonly NumericFormat[] = [
  "timecode",
  "float",
  "integer",
  "auto",
]

export type NumericConfig = {
  format: NumericFormat
  /** Границы слайдера — в единицах хранения. */
  min: number
  max: number
  step: number
  decimals: number
  /** Разрешить значению выходить за границы слайдера (ручной ввод). */
  allowManualOverride: boolean
}

type ControlProps = Record<string, unknown> | null | undefined

type ConfigDefaults = {
  format?: NumericFormat
  min: number
  max: number
  step?: number
  decimals?: number
}

/** Число или fallback. */
function num(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function isFormat(raw: unknown): raw is NumericFormat {
  return (
    typeof raw === "string" && NUMERIC_FORMATS.includes(raw as NumericFormat)
  )
}

/**
 * Собирает конфиг из `controlProps`. `min`/`max` резолвит вызывающий: у
 * `valueRange` они в `range`, у `slider` — в `minValue`/`maxValue`.
 */
export function resolveNumericConfig(
  controlProps: ControlProps,
  defaults: ConfigDefaults,
): NumericConfig {
  const cp = controlProps ?? {}
  const format = isFormat(cp.format) ? cp.format : (defaults.format ?? "auto")

  const min = num(defaults.min, 0)
  let max = num(defaults.max, min + 1)

  // Шаг — в тех же единицах, что значение (для таймкода это секунды).
  const rawStep = num(cp.step ?? defaults.step, 1)
  const step = rawStep > 0 ? rawStep : 1

  // decimals осмысленны только для float; иначе целые показывались бы как «5.00».
  const decimals =
    format === "float"
      ? Math.min(6, Math.max(0, Math.round(num(cp.decimals ?? defaults.decimals, 2))))
      : 0

  // Вырожденный диапазон (max ≤ min) слайдер не переживает.
  if (max <= min) max = min + step

  return {
    format,
    min,
    max,
    step,
    decimals,
    allowManualOverride: cp.allowManualOverride !== false,
  }
}

/** Округление под формат: целое / до `decimals` знаков / как есть. */
export function roundForFormat(value: number, cfg: NumericConfig): number {
  if (!Number.isFinite(value)) return cfg.min
  if (cfg.format === "float") {
    const p = Math.pow(10, cfg.decimals)
    return Math.round(value * p) / p
  }
  // auto — «как есть», но без мусора плавающей точки (0.30000000000000004).
  if (cfg.format === "auto") return Math.round(value * 1e6) / 1e6
  return Math.round(value)
}

/** Округление под формат + зажим в границы слайдера. */
export function clampForFormat(value: number, cfg: NumericConfig): number {
  // Сначала округляем, потом зажимаем: иначе округление вверх вылезает за max.
  const rounded = roundForFormat(value, cfg)
  return Math.min(cfg.max, Math.max(cfg.min, rounded))
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Секунды → `HH:MM:SS` (часов может быть больше 24). */
export function secondsToTimecode(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : ""
  const t = Math.abs(
    Math.round(Number.isFinite(totalSeconds) ? totalSeconds : 0),
  )
  return `${sign}${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`
}

/** `HH:MM:SS` / `MM:SS` → секунды. `null` — разобрать не удалось. */
export function timecodeToSeconds(text: string): number | null {
  const t = String(text).trim()
  if (t === "") return null
  const negative = t.startsWith("-")
  const parts = (negative ? t.slice(1) : t).split(":")
  if (parts.length < 2 || parts.length > 3) return null

  const nums = parts.map((p) =>
    p.trim() === "" ? 0 : Number(p.trim().replace(",", ".")),
  )
  if (nums.some((n) => !Number.isFinite(n))) return null

  const seconds =
    nums.length === 3
      ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]!
      : nums[0]! * 60 + nums[1]!
  return negative ? -seconds : seconds
}

/** Значение (в единицах хранения) → текст для поля или подписи. */
export function formatNumeric(value: number, cfg: NumericConfig): string {
  const n = Number.isFinite(value) ? value : cfg.min
  if (cfg.format === "timecode") return secondsToTimecode(n)
  if (cfg.format === "float") return n.toFixed(cfg.decimals)
  if (cfg.format === "integer") return String(Math.round(n))
  return String(n)
}

/**
 * Текст из поля → значение в единицах хранения. `null` — мусор на входе:
 * вызывающий возвращает прежнее значение, а не прыгает в min.
 *
 * Для таймкода одиночное число без `:` — это секунды, а не часы.
 */
export function parseNumeric(
  text: string,
  cfg: NumericConfig,
  allowOverride = false,
): number | null {
  const t = String(text).trim()
  if (t === "") return null

  let parsed: number
  if (cfg.format === "timecode" && t.includes(":")) {
    const seconds = timecodeToSeconds(t)
    if (seconds === null) return null
    parsed = seconds
  } else {
    const n = Number(t.replace(",", "."))
    if (!Number.isFinite(n)) return null
    parsed = n
  }

  const rounded = roundForFormat(parsed, cfg)
  return allowOverride
    ? rounded
    : Math.min(cfg.max, Math.max(cfg.min, rounded))
}

/** Нормализация значения, пришедшего извне (файл, слайдер, вход ноды). */
export function normalizeNumeric(value: number, cfg: NumericConfig): number {
  return cfg.allowManualOverride
    ? roundForFormat(value, cfg)
    : clampForFormat(value, cfg)
}

/** 24 часа в секундах — дефолтный потолок таймкодового диапазона. */
const MAX_SECONDS = 86_400
/** Дефолт границ у старых нетаймкодовых valueRange. */
const LEGACY_MAX = 1_440

/**
 * Конфиг для `valueRange`: границы лежат в `range`. Без явного `range`
 * таймкод получает сутки в секундах, у остальных форматов дефолт исторический.
 */
export function valueRangeConfig(controlProps: ControlProps): NumericConfig {
  const cp = controlProps ?? {}
  const format = isFormat(cp.format) ? cp.format : "timecode"
  const defaultMax = format === "timecode" ? MAX_SECONDS : LEGACY_MAX
  const range = Array.isArray(cp.range) ? (cp.range as unknown[]) : null

  return resolveNumericConfig(cp, {
    format: "timecode",
    min: num(range?.[0], 0),
    max: num(range?.[1], defaultMax),
    step: 5,
  })
}

/**
 * Конфиг для `slider`: границы в `minValue`/`maxValue` (`range` у слайдера не
 * используется). Формат по умолчанию `auto`: у старых слайдеров `format` не
 * задан, и показывать «50» как «50.00» нельзя.
 */
export function sliderConfig(controlProps: ControlProps): NumericConfig {
  const cp = controlProps ?? {}
  return resolveNumericConfig(cp, {
    format: "auto",
    min: num(cp.minValue, 0),
    max: num(cp.maxValue, 100),
    step: 1,
  })
}

/** Конфиг по `controlType` — там, где контрол известен только строкой. */
export function numericConfigFor(
  controlType: string,
  controlProps: ControlProps,
): NumericConfig {
  return controlType === "slider"
    ? sliderConfig(controlProps)
    : valueRangeConfig(controlProps)
}

/**
 * Ввод пользователя в поле `timecode` → секунды. Порт `parseUserInput` из
 * `NODE_WIN/nodes/properties/TimeCode.tsx`, включая его диалекты:
 *
 *   `01:30:00` → часы:минуты:секунды
 *   `01:30`    → минуты:секунды
 *   `90`       → 90 секунд
 *   `1.30`     → минуты.секунды, то есть 90 секунд
 *
 * Последний выглядит странно, но он есть в программе и подписан в подсказках
 * свойств: разойтись с ним значит понять пользователя иначе, чем поймёт нода.
 */
export function parseTimecodeInput(input: string): number {
  const text = String(input).trim()
  if (text === "") return 0

  if (text.includes(":")) {
    const parts = text.split(":").map((p) => Number.parseInt(p, 10) || 0)
    if (parts.length === 3) {
      return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!
    }
    if (parts.length === 2) return parts[0]! * 60 + parts[1]!
  }

  const normalized = text.replace(",", ".")
  if (normalized.includes(".")) {
    const parts = normalized.split(".")
    let total = 0
    if (parts[0]) total += (Number.parseInt(parts[0], 10) || 0) * 60
    if (parts[1]) {
      const raw = Number.parseInt(parts[1], 10) || 0
      total += Math.floor(raw / 60) * 60 + (raw % 60)
    }
    if (parts[2]) total += (Number.parseInt(parts[2], 10) || 0) * 3600
    return total
  }

  return Number.parseInt(normalized, 10) || 0
}
