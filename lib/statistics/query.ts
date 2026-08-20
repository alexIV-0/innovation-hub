import { z } from "zod"
import {
  STAT_BREAKDOWNS,
  STAT_PERIODS,
  type StatBreakdown,
  type StatPeriod,
} from "@/lib/statistics/types"

/**
 * Разбор осей из query-строки. Один разбор на две витрины: скоуп добавляет
 * роут, а не клиент, — иначе кабинет сможет попросить чужие данные.
 */
export const statisticsQuerySchema = z.object({
  breakdown: z.enum(STAT_BREAKDOWNS).default("user"),
  period: z.enum(STAT_PERIODS).default("30d"),
  userId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
})

export type StatisticsQuery = {
  breakdown: StatBreakdown
  period: StatPeriod
  userId: string | null
  projectId: string | null
}

export function parseStatisticsQuery(
  params: URLSearchParams,
): StatisticsQuery | null {
  const parsed = statisticsQuerySchema.safeParse({
    breakdown: params.get("breakdown") ?? undefined,
    period: params.get("period") ?? undefined,
    userId: params.get("userId") || null,
    projectId: params.get("projectId") || null,
  })
  if (!parsed.success) return null
  return {
    breakdown: parsed.data.breakdown,
    period: parsed.data.period,
    userId: parsed.data.userId ?? null,
    projectId: parsed.data.projectId ?? null,
  }
}
