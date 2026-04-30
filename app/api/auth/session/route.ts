import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import type { UserRole } from "@/lib/domain-types"

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

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email,
    role: (session.role ?? "USER") as UserRole,
  })
}
