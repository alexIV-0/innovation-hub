import { NextResponse } from "next/server"
import { loginSchema } from "@/lib/auth-schemas"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
  verifyPassword,
} from "@/lib/auth"
import { findUserByEmail } from "@/lib/repositories/users"

export async function POST(request: Request) {
  const payload = await request.json()
  const parsed = loginSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid credentials format.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const user = await findUserByEmail(parsed.data.email.toLowerCase())
  if (!user) {
    return NextResponse.json(
      { message: "Invalid email or password." },
      { status: 401 },
    )
  }

  if (!user.isActive) {
    return NextResponse.json(
      { message: "Account is inactive." },
      { status: 403 },
    )
  }

  const isValidPassword = await verifyPassword(
    parsed.data.password,
    user.passwordHash,
  )
  if (!isValidPassword) {
    return NextResponse.json(
      { message: "Invalid email or password." },
      { status: 401 },
    )
  }

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    email: user.email,
  })

  const response = NextResponse.json(
    {
      message: `Welcome back, ${user.fullName}.`,
      role: user.role,
    },
    { status: 200 },
  )

  response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieConfig())
  return response
}
