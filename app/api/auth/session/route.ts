import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { readTrialState } from "@/lib/billing/trial"
import type { UserRole } from "@/lib/domain-types"
import { findUserById } from "@/lib/repositories/users"

export async function GET() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ authenticated: false })
  }

  const session = await verifySessionToken(token)
  if (!session?.userId || !session.email) {
    return NextResponse.json({ authenticated: false })
  }

  const user = await findUserById(session.userId)

  /**
   * Доступен ли человеку тестовый период — здесь, а не отдельным запросом:
   * шапка опрашивает сессию на каждой навигации, и второй поход за одним
   * булевым значением был бы дороже, чем поле в этом ответе.
   *
   * Сбой не роняет сессию: не смогли выяснить — считаем, что предлагать нечего.
   * Кнопка, которой нет, лучше страницы, которая не открылась.
   */
  let trialAvailable = false
  try {
    const state = await readTrialState(session.userId)
    trialAvailable = state.status === "available"
  } catch (error) {
    console.error("[session] trial state failed", error)
  }

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email,
    fullName: user?.fullName ?? null,
    role: (session.role ?? user?.role ?? "USER") as UserRole,
    trialAvailable,
  })
}
