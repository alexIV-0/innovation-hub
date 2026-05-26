import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
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

  return NextResponse.json({
    authenticated: true,
    userId: session.userId,
    email: session.email,
    fullName: user?.fullName ?? null,
    role: (session.role ?? user?.role ?? "USER") as UserRole,
  })
}
