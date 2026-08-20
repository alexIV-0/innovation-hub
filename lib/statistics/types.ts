/**
 * Оси раздела статистики. Один набор типов на три слоя: запросы, API и UI —
 * иначе скоуп «только своё» расходится между админкой и кабинетом, а его
 * расхождение и есть главный риск этого раздела (docs/STATISTICS_PLAN.md §6).
 */

/** Метрика: что считаем. */
export const STAT_METRICS = [
  "files",
  "bytes",
  "tasks",
  "errors",
  "procs",
  "spend",
  "render",
] as const
export type StatMetric = (typeof STAT_METRICS)[number]

/** Разрез: по чему группируем. */
export const STAT_BREAKDOWNS = [
  "user",
  "project",
  "fileType",
  "machine",
] as const
export type StatBreakdown = (typeof STAT_BREAKDOWNS)[number]

/** Период события. Состояния («сейчас в хранилище») от него не зависят. */
export const STAT_PERIODS = ["7d", "30d", "90d", "12m", "all"] as const
export type StatPeriod = (typeof STAT_PERIODS)[number]

export type StatBucketUnit = "day" | "week" | "month"

/**
 * Скоуп запроса. `ownerId` — жёсткая рамка кабинета: свои проекты плюс
 * расшаренные. У админки он null, и это единственное отличие двух витрин.
 * `userId`/`projectId` — провал в элемент, доступен обеим.
 */
export type StatsScope = {
  ownerId: string | null
  userId: string | null
  projectId: string | null
}

/** Состояние на сейчас: период на него не влияет. */
export type StatsTotals = {
  files: number
  bytes: number
  projects: number
  tasksTotal: number
  tasksDone: number
  tasksFailed: number
  /** Только для админки: сколько активных пользователей попало в скоуп. */
  users: number | null
  /** Архив обработок. Ноль значит «архив ещё не импортирован». */
  procsTotal: number
  procsDone: number
  procsError: number
  spend: number
  /** Медиана и p95 важнее среднего: среднее прячет выбросы (§6.2). */
  renderP50: number | null
  renderP95: number | null
}

/** Строка разреза. Все метрики сразу — переключение метрики не ходит на сервер. */
export type StatsRow = {
  key: string
  label: string
  files: number
  bytes: number
  tasks: number
  errors: number
  procs: number
  spend: number
  render: number
  /** Куда можно провалиться кликом. */
  drill: "user" | "project" | null
}

export type StatsBucket = {
  bucket: string
  files: number
  bytes: number
  tasks: number
  errors: number
  procs: number
  spend: number
  render: number
}

/** Точка ряда «объём в хранилище»: состояние на конец интервала. */
export type StatsVolumePoint = {
  bucket: string
  bytes: number
  files: number
}

/** Столбик гистограммы длительностей. `to = null` — последний, открытый бин. */
export type StatsHistogramBin = {
  from: number
  to: number | null
  count: number
}

/** Шаг воронки задач конвейера. Порядок — от находки к результату. */
export type StatsFunnelStep = {
  status: "queued" | "claimed" | "running" | "done" | "failed"
  count: number
}

/** Строка вклада в карточке элемента: участник проекта или проект пользователя. */
export type StatsCardRow = {
  key: string
  label: string
  files: number
  bytes: number
}

/**
 * Карточка элемента: фиксированный набор по §6.2, а не конструктор. Появляется
 * при провале в проект или пользователя.
 */
export type StatsElementCard = {
  kind: "project" | "user"
  title: string
  subtitle: string | null
  lastActivityAt: string | null
  /**
   * Сколько человек имеет доступ к проекту помимо владельца. Ноль — проект не
   * расшарен. Для карточки пользователя всегда ноль.
   */
  members: number
  /** Для проекта — кто в нём работал; для пользователя — его проекты. */
  contributors: StatsCardRow[]
  fileTypes: StatsCardRow[]
}

export type StatsResponse = {
  totals: StatsTotals
  rows: StatsRow[]
  timeline: StatsBucket[]
  /** Состояние по снимкам. Пустой ряд значит «снимки ещё не копились». */
  volume: StatsVolumePoint[]
  /** Распределение времени рендера по архиву. */
  histogram: StatsHistogramBin[]
  /** Где стоит работа: задачи конвейера по статусам. */
  funnel: StatsFunnelStep[]
  /** Карточка элемента — только при провале в проект или пользователя. */
  card: StatsElementCard | null
  bucketUnit: StatBucketUnit
  breakdown: StatBreakdown
  period: StatPeriod
  /** Подписи активных фильтров провала — чтобы UI не ходил за ними отдельно. */
  scope: {
    userId: string | null
    userLabel: string | null
    projectId: string | null
    projectLabel: string | null
  }
  /** Сколько строк отброшено лимитом. Молчаливых обрезаний быть не должно. */
  truncated: number
}

export const STAT_ROW_LIMIT = 200

/** Период → шаг таймлайна и окно. `all` показывает 36 месяцев, разрез — всё. */
export function periodToBuckets(period: StatPeriod): {
  unit: StatBucketUnit
  span: string
  step: string
} {
  switch (period) {
    case "7d":
      return { unit: "day", span: "6 days", step: "1 day" }
    case "30d":
      return { unit: "day", span: "29 days", step: "1 day" }
    case "90d":
      return { unit: "week", span: "12 weeks", step: "1 week" }
    case "12m":
      return { unit: "month", span: "11 months", step: "1 month" }
    case "all":
      return { unit: "month", span: "35 months", step: "1 month" }
  }
}

/** Окно фильтра для строк разреза. `all` — без ограничения по времени. */
export function periodToInterval(period: StatPeriod): string | null {
  switch (period) {
    case "7d":
      return "7 days"
    case "30d":
      return "30 days"
    case "90d":
      return "90 days"
    case "12m":
      return "12 months"
    case "all":
      return null
  }
}
