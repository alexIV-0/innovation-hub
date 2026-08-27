import {
  isPayBase,
  isPayMeter,
  isSupportedPair,
  payPair,
  type PayBase,
  type PayMeter,
  type PayPair,
} from "@/lib/billing/types"

/**
 * Единица тарификации проекта: две оси — «от чего отталкиваемся» и «в чём
 * считаем» (docs/BILLING_AND_TRIAL_PLAN.md, П6).
 *
 * Разрешается по приоритету: граф → настройка проекта → отказ. Граф главнее,
 * потому что выход проектирует его автор и он один знает, что получится. Но
 * настройка проекта — не временный костыль: `onInit` в десктопе ставит ноды из
 * `options.json` как есть, и новые свойства в СТАРЫЕ графы сами не приезжают.
 * Значит проекты, чей граф не переоткрывали, останутся без осей навсегда.
 *
 * Пара проверяется целиком, а не каждая ось отдельно: сочетание может быть
 * синтаксически верным и при этом нечем считаться (`source × sec` — нужен
 * `srcSec`, поле схемы v2 архива). Молча считать «как получится» хуже, чем
 * отказать с внятной причиной.
 */

export type PayUnitSource = "graph" | "project"

export type PayUnitResolution =
  | {
      ok: true
      base: PayBase
      meter: PayMeter | null
      pair: PayPair
      source: PayUnitSource
    }
  | { ok: false; reason: PayUnitProblem }

/** Почему тарифицировать нечем. Значения видны в «Конвейере» как причина пропуска. */
export type PayUnitProblem =
  /** Оси не объявлены ни в графе, ни в настройке проекта. */
  | "no-pay-unit"
  /** Пара синтаксически верна, но такой сайт считать не умеет. */
  | "unsupported-pay-pair"
  /** Пара противоречит тому, что граф ищет на входе. */
  | "pay-unit-mismatch"

export type PayAxes = {
  base: unknown
  meter: unknown
}

function normalize(axes: PayAxes): { base: PayBase; meter: PayMeter | null } | null {
  if (!isPayBase(axes.base)) return null
  if (axes.base === "fixed") return { base: "fixed", meter: null }
  if (!isPayMeter(axes.meter)) return null
  return { base: axes.base, meter: axes.meter }
}

export function resolvePayUnit(input: {
  /** Из ноды `description` графа. */
  graph: PayAxes
  /** Из колонок `projects.pay_base` / `pay_meter`. */
  project: PayAxes
}): PayUnitResolution {
  const candidates: { axes: PayAxes; source: PayUnitSource }[] = [
    { axes: input.graph, source: "graph" },
    { axes: input.project, source: "project" },
  ]

  for (const candidate of candidates) {
    const normalized = normalize(candidate.axes)
    if (!normalized) continue
    const pair = payPair(normalized.base, normalized.meter)
    // Неподдержанная пара НЕ пропускается к следующему кандидату: автор графа
    // сказал, чем считать, и подменять его настройкой проекта значило бы
    // тарифицировать не тем, что он объявил. Отказ здесь виден и чинится.
    if (!isSupportedPair(pair)) return { ok: false, reason: "unsupported-pay-pair" }
    return { ok: true, ...normalized, pair, source: candidate.source }
  }

  return { ok: false, reason: "no-pay-unit" }
}

/**
 * Типы файлов, у которых есть хронометраж. Имена — из общего словаря
 * (`automation_settings`), тот же набор, по которому десктоп решает, чем мерить
 * длительность выхода.
 */
const TIME_BASED_TYPES = new Set(["video", "audio"])

/**
 * Согласована ли пара с тем, что граф ищет на входе.
 *
 * Проверяется при разборе графа, а не при первой обработке: тип входа объявлен в
 * `mainSearch` и уже разобран сборкой задачи. Поймать «проект тарифицируется по
 * `source × sec`, а ищет картинки» до обработки дешевле, чем обнаружить пустой
 * `srcSec` постфактум — когда работа сделана, а выставить за неё нечего.
 *
 * Проверка узкая намеренно. `output × sec` по входу не проверяется вовсе: из
 * картинок вполне делают видео, и запрет здесь был бы ложным срабатыванием.
 */
export function matchesSearchType(input: {
  pair: PayPair
  /** Имя типа из общего словаря: `video`, `image`, `audio`… */
  searchType: string | null
}): boolean {
  if (input.pair !== "source:sec") return true
  const type = input.searchType?.trim().toLowerCase()
  if (!type) return false
  return TIME_BASED_TYPES.has(type)
}

/** Полная проверка: разрешить оси и сверить их с типом входа. */
export function resolvePayUnitForGraph(input: {
  graph: PayAxes
  project: PayAxes
  searchType: string | null
}): PayUnitResolution {
  const resolved = resolvePayUnit(input)
  if (!resolved.ok) return resolved
  if (!matchesSearchType({ pair: resolved.pair, searchType: input.searchType })) {
    return { ok: false, reason: "pay-unit-mismatch" }
  }
  return resolved
}
