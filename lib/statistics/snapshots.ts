import { query } from "@/lib/db"
import {
  periodToBuckets,
  periodToInterval,
  type StatPeriod,
  type StatsScope,
  type StatsVolumePoint,
} from "@/lib/statistics/types"

/**
 * Снимки состояний: единственный источник для вопроса «как рос объём»
 * (docs/STATISTICS_PLAN.md §3). Пишет их суточный тик, читает статистика.
 */

/**
 * Снять срез за сегодня. Идемпотентно: повторный вызов в тот же день
 * перезаписывает строки, поэтому тик может дёргаться сколько угодно раз.
 *
 * Проекты без файлов тоже получают строку с нулями — иначе «сколько проектов
 * было в тот день» посчитать нельзя.
 */
export async function takeStorageSnapshot(): Promise<{ projects: number }> {
  const result = await query(
    `INSERT INTO storage_snapshots (day, project_id, owner_id, files, bytes)
     SELECT CURRENT_DATE,
            p.id,
            p.user_id,
            COUNT(f.id)::int,
            COALESCE(SUM(f.size_bytes), 0)::bigint
       FROM projects p
       LEFT JOIN project_files f
              ON f.project_id = p.id
             AND f.is_folder = FALSE
             AND f.deleted_at IS NULL
      -- Проекты в корзине не снимаем: иначе ряд «рост объёма» разойдётся с
      -- плитками, где корзина исключена, и одна и та же страница покажет два
      -- разных объёма. Уже снятые дни не переписываются — это честная история.
      WHERE p.deleted_at IS NULL
      GROUP BY p.id, p.user_id
     ON CONFLICT (day, project_id) DO UPDATE
        SET files    = EXCLUDED.files,
            bytes    = EXCLUDED.bytes,
            owner_id = EXCLUDED.owner_id,
            taken_at = NOW()`,
  )
  return { projects: result.rowCount ?? 0 }
}

/**
 * Ряд «объём в хранилище» по снимкам.
 *
 * Две тонкости, из-за которых это не обычный GROUP BY:
 *
 * 1. Состояния нельзя суммировать по времени. За месяц берётся **последний**
 *    срез месяца, а не сумма суточных — иначе объём вырастет в тридцать раз на
 *    ровном месте.
 * 2. Проект здесь относится к владельцу, а не к заливщику: у снимка нет
 *    атрибуции по файлам. Поэтому провал в пользователя показывает объём его
 *    проектов, а не то, сколько он залил в чужие.
 */
export async function loadVolumeSeries(
  scope: StatsScope,
  period: StatPeriod,
): Promise<StatsVolumePoint[]> {
  const { unit } = periodToBuckets(period)
  const params: unknown[] = [unit]
  const where: string[] = []

  if (scope.ownerId) {
    // Только свои проекты: расшаренный проект принадлежит другому человеку, и
    // его объём — его статистика (см. scopeConditions в repositories/statistics).
    params.push(scope.ownerId)
    where.push(`s.owner_id = $${params.length}`)
  }
  if (scope.userId) {
    params.push(scope.userId)
    where.push(`s.owner_id = $${params.length}`)
  }
  if (scope.projectId) {
    params.push(scope.projectId)
    where.push(`s.project_id = $${params.length}`)
  }
  const interval = periodToInterval(period)
  if (interval) {
    params.push(interval)
    where.push(`s.day >= CURRENT_DATE - $${params.length}::interval`)
  }

  const result = await query<{ bucket: Date; bytes: string; files: number }>(
    `WITH per_day AS (
        SELECT s.day,
               SUM(s.bytes)::bigint AS bytes,
               SUM(s.files)::int AS files
          FROM storage_snapshots s
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         GROUP BY s.day
     )
     SELECT DISTINCT ON (date_trunc($1::text, day))
            date_trunc($1::text, day) AS bucket,
            bytes,
            files
       FROM per_day
      ORDER BY date_trunc($1::text, day), day DESC`,
    params,
  )

  return result.rows
    .map((r) => ({
      bucket: new Date(r.bucket).toISOString(),
      bytes: Number(r.bytes),
      files: r.files,
    }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}
