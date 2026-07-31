import { NextResponse } from "next/server"
import { loginSchema } from "@/lib/auth-schemas"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
  verifyPassword,
} from "@/lib/auth"
import { provisionUserDriveFolderBackground } from "@/lib/provision-drive"
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

  // OAuth-only accounts (e.g. Google sign-in) have no password hash. Direct
  // them to the matching provider rather than leaking which account exists.
  if (!user.passwordHash) {
    return NextResponse.json(
      {
        message:
          user.authProvider === "google"
            ? "This account uses Google sign-in. Please continue with Google."
            : "This account uses single sign-on. Please use the matching provider.",
      },
      { status: 401 },
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

  if (!user.driveFolderId) {
    provisionUserDriveFolderBackground(user.id)
  }

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
