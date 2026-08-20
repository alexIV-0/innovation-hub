import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { getStatistics } from "@/lib/repositories/statistics"
import { parseStatisticsQuery } from "@/lib/statistics/query"

export const runtime = "nodejs"

/**
 * Та же статистика со скоупом «только своё»: свои проекты плюс расшаренные.
 * `ownerId` берётся из сессии и клиентом не переопределяется.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const q = parseStatisticsQuery(request.nextUrl.searchParams)
  if (!q) {
    return NextResponse.json({ message: "Invalid query." }, { status: 400 })
  }

  const data = await getStatistics({
    scope: { ownerId: auth.userId, userId: q.userId, projectId: q.projectId },
    breakdown: q.breakdown,
    period: q.period,
  })
  return NextResponse.json(data)
}
