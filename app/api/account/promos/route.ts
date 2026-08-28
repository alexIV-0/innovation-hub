import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { listAccountPromos } from "@/lib/billing/grants"
import { readTrialState } from "@/lib/billing/trial"

export const runtime = "nodejs"

/**
 * Акции этого человека: что ему уже начислили и что он ещё может взять.
 *
 * Только про себя: чужие подарки отсюда не видны и не выдаются. Раздача — дело
 * админского инструмента `billing.promo`, здесь чтение своего.
 *
 * Отдельно от `/api/account/balance`: тот висит в боковой панели на каждой
 * странице и обязан оставаться дешёвым, а список подарков с проектами нужен
 * ровно на одном экране — кошельке.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const [promos, trial] = await Promise.all([
    listAccountPromos(auth.userId),
    readTrialState(auth.userId),
  ])

  // Неиспользованный тестовый период — тоже акция, просто ещё не взятая. Не
  // показать её здесь значило бы спрятать подарок на другом экране: человек
  // пришёл в кошелёк именно за ответом «а что мне полагается».
  const offer =
    trial.status === "available"
      ? { amountCents: trial.amountCents, lifetimeDays: trial.lifetimeDays }
      : null

  return NextResponse.json({ promos, offer })
}
