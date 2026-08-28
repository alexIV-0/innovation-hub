import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { isSpendPeriod, readSpending } from "@/lib/billing/spending"

export const runtime = "nodejs"

/**
 * Расход по деньгам за период.
 *
 * Скоуп ставит роут, а не клиент: за расшаренный проект платит владелец, и
 * подсмотреть чужую ленту, подставив `ownerId`, быть не должно возможности.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const raw = request.nextUrl.searchParams.get("period")
  const period = isSpendPeriod(raw) ? raw : "month"
  const projectId = request.nextUrl.searchParams.get("projectId")

  return NextResponse.json(
    await readSpending({ ownerId: auth.userId, period, projectId }),
  )
}
