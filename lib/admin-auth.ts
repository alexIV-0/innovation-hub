import { cookies } from "next/headers"
import { NextResponse, type NextRequest } from "next/server"
import { findUserById } from "@/lib/repositories/users"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null

  const session = await verifySessionToken(token)
  if (!session?.userId) return null

  return findUserById(session.userId)
}

export type AuthenticatedApiUser = {
  userId: string
  email: string
  role: import("@/lib/domain-types").UserRole
}

/** Any signed-in active user (not admin-only). */
export async function requireUserApi(
  request: NextRequest,
): Promise<AuthenticatedApiUser | NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json(
      { message: "Sign in to submit a suggestion." },
      { status: 401 },
    )
  }

  const session = await verifySessionToken(token)
  if (!session?.userId) {
    return NextResponse.json(
      { message: "Sign in to submit a suggestion." },
      { status: 401 },
    )
  }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) {
    return NextResponse.json(
      { message: "Account is inactive." },
      { status: 403 },
    )
  }

  return { userId: user.id, email: user.email, role: user.role }
}

export async function requireAdminApi(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const session = await verifySessionToken(token)
  if (!session?.userId) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) {
    return NextResponse.json({ message: "Account is inactive." }, { status: 403 })
  }

  if (user.role !== "ADMIN") {
    return NextResponse.json({ message: "Admin access required." }, { status: 403 })
  }

  return { userId: user.id }
}
