import { query } from "@/lib/db"

/**
 * Куда ушли деньги — витрина для кабинета.
 *
 * Не «вся статистика», а только деньги: сколько потрачено за период, какие
 * проекты съедают больше всего и кто в них работал. Разрезы по файлам, задачам
 * и машинам живут в разделе «Статистика» и сюда не переезжают — это разные
 * вопросы, и смешав их, получим экран, на котором не найти ни того, ни другого.
 *
 * Скоуп всегда владельческий: за расшаренный проект платит владелец, поэтому и
 * видит расход он. Участник чужой ленты не видит.
 */

export const SPEND_PERIODS = ["day", "week", "month", "year"] as const
export type SpendPeriod = (typeof SPEND_PERIODS)[number]

export function isSpendPeriod(value: unknown): value is SpendPeriod {
  return (
    typeof value === "string" &&
    (SPEND_PERIODS as readonly string[]).includes(value)
  )
}

/**
 * Окно и шаг таймлайна.
 *
 * Начинаем с месяца по дням — это тот масштаб, на котором вопрос «куда ушли
 * деньги» вообще задают. Провал внутрь меняет и окно, и шаг: неделя по дням,
 * день по часам.
 */
const WINDOW: Record<SpendPeriod, { interval: string; bucket: string }> = {
  day: { interval: "1 day", bucket: "hour" },
  week: { interval: "7 days", bucket: "day" },
  month: { interval: "1 month", bucket: "day" },
  year: { interval: "1 year", bucket: "month" },
}

export type SpendTotals = {
  /** Списано с кошельков — то, что человек реально заплатил. */
  spentCents: number
  /** Из них наша работа и внешние сервисы — раскладка из П5. */
  ourCents: number
  vendorCents: number
  /** Покрыто подарком: полезно видеть отдельно, иначе «потрачено» вводит в заблуждение. */
  giftCents: number
  ownCents: number
  /** Сколько обработок за период. */
  runs: number
}

export type SpendBucket = { at: string; spentCents: number }

export type SpendProject = {
  projectId: string | null
  name: string
  spentCents: number
  vendorCents: number
  runs: number
}

export type SpendWorker = {
  userId: string | null
  name: string
  email: string | null
  spentCents: number
  runs: number
}

export type SpendReport = {
  period: SpendPeriod
  totals: SpendTotals
  timeline: SpendBucket[]
  projects: SpendProject[]
  /** Заполнено только при провале в проект. */
  workers: SpendWorker[] | null
}

const CHARGE_KINDS = `('charge', 'writeoff', 'exempt')`

export async function readSpending(input: {
  ownerId: string
  period: SpendPeriod
  projectId?: string | null
}): Promise<SpendReport> {
  const { interval, bucket } = WINDOW[input.period]
  const projectFilter = input.projectId ? `AND b.project_id = $3` : ""
  const params: unknown[] = [input.ownerId, interval]
  if (input.projectId) params.push(input.projectId)

  const totals = await query<{
    spentCents: string
    ourCents: string
    vendorCents: string
    giftCents: string
    ownCents: string
    runs: number
  }>(
    `SELECT COALESCE(SUM(-b.amount_cents) FILTER (WHERE b.kind = 'charge'), 0)::text AS "spentCents",
            COALESCE(SUM(b.our_cents), 0)::text    AS "ourCents",
            COALESCE(SUM(b.vendor_cents), 0)::text AS "vendorCents",
            COALESCE(SUM(-b.amount_cents) FILTER (WHERE b.wallet = 'gift'), 0)::text AS "giftCents",
            COALESCE(SUM(-b.amount_cents) FILTER (WHERE b.wallet = 'own'), 0)::text  AS "ownCents",
            COUNT(DISTINCT b.task_id)::int AS runs
       FROM billing_transactions b
      WHERE b.user_id = $1
        AND b.kind IN ${CHARGE_KINDS}
        AND b.created_at > NOW() - $2::interval
        ${projectFilter}`,
    params,
  )

  const timeline = await query<{ at: string; spentCents: string }>(
    `SELECT to_char(date_trunc('${bucket}', b.created_at), 'YYYY-MM-DD"T"HH24:00') AS at,
            COALESCE(SUM(-b.amount_cents) FILTER (WHERE b.kind = 'charge'), 0)::text AS "spentCents"
       FROM billing_transactions b
      WHERE b.user_id = $1
        AND b.kind IN ${CHARGE_KINDS}
        AND b.created_at > NOW() - $2::interval
        ${projectFilter}
      GROUP BY 1
      ORDER BY 1`,
    params,
  )

  const projects = await query<{
    projectId: string | null
    name: string
    spentCents: string
    vendorCents: string
    runs: number
  }>(
    `SELECT b.project_id AS "projectId",
            COALESCE(p.name, '') AS name,
            COALESCE(SUM(-b.amount_cents) FILTER (WHERE b.kind = 'charge'), 0)::text AS "spentCents",
            COALESCE(SUM(b.vendor_cents), 0)::text AS "vendorCents",
            COUNT(DISTINCT b.task_id)::int AS runs
       FROM billing_transactions b
       LEFT JOIN projects p ON p.id = b.project_id
      WHERE b.user_id = $1
        AND b.kind IN ${CHARGE_KINDS}
        AND b.created_at > NOW() - $2::interval
        ${projectFilter}
      GROUP BY b.project_id, p.name
      ORDER BY 3 DESC`,
    params,
  )

  return {
    period: input.period,
    totals: {
      spentCents: Number(totals.rows[0]?.spentCents ?? 0),
      ourCents: Number(totals.rows[0]?.ourCents ?? 0),
      vendorCents: Number(totals.rows[0]?.vendorCents ?? 0),
      giftCents: Number(totals.rows[0]?.giftCents ?? 0),
      ownCents: Number(totals.rows[0]?.ownCents ?? 0),
      runs: totals.rows[0]?.runs ?? 0,
    },
    timeline: timeline.rows.map((row) => ({
      at: row.at,
      spentCents: Number(row.spentCents),
    })),
    projects: projects.rows.map((row) => ({
      projectId: row.projectId,
      name: row.name,
      spentCents: Number(row.spentCents),
      vendorCents: Number(row.vendorCents),
      runs: row.runs,
    })),
    workers: input.projectId
      ? await readWorkers({ ownerId: input.ownerId, projectId: input.projectId, interval })
      : null,
  }
}

/**
 * Кто работал в проекте — по заливщику исходника.
 *
 * ⚠️ Ответ приблизительный, и по-другому не выйдет. Атрибуция берётся из
 * `project_files.uploaded_by` через `tasks.source_file_id`, а у папки источник
 * не один файл, и `source_file_id` там пустой — такая работа попадает в строку
 * «не определён». Точный ответ жил в `payload.description.contact`, но
 * `taskDone` заменяет payload итогом, и к моменту списания его уже нет.
 */
async function readWorkers(input: {
  ownerId: string
  projectId: string
  interval: string
}): Promise<SpendWorker[]> {
  const result = await query<{
    userId: string | null
    name: string
    email: string | null
    spentCents: string
    runs: number
  }>(
    `SELECT u.id AS "userId",
            COALESCE(u.contact_name, u.full_name, '') AS name,
            u.email,
            COALESCE(SUM(-b.amount_cents) FILTER (WHERE b.kind = 'charge'), 0)::text AS "spentCents",
            COUNT(DISTINCT b.task_id)::int AS runs
       FROM billing_transactions b
       LEFT JOIN tasks t ON t.id = b.task_id
       LEFT JOIN project_files f ON f.id = t.source_file_id
       LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE b.user_id = $1
        AND b.project_id = $2
        AND b.kind IN ${CHARGE_KINDS}
        AND b.created_at > NOW() - $3::interval
      GROUP BY u.id, u.contact_name, u.full_name, u.email
      ORDER BY 4 DESC`,
    [input.ownerId, input.projectId, input.interval],
  )

  return result.rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    spentCents: Number(row.spentCents),
    runs: row.runs,
  }))
}
