import { NextResponse } from "next/server"
import { updateProfileSchema } from "@/lib/account-schemas"
import {
  SESSION_COOKIE_NAME,
  buildSessionCookieConfig,
  createSessionToken,
} from "@/lib/auth"
import { getCurrentUser } from "@/lib/admin-auth"
import {
  findUserByEmail,
  updateUser,
} from "@/lib/repositories/users"
import { syncUserMeta } from "@/lib/project-storage"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  return NextResponse.json({
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
  })
}

export async function PATCH(request: Request) {
  const current = await getCurrentUser()
  if (!current) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  if (!current.isActive) {
    return NextResponse.json(
      { message: "Account is inactive." },
      { status: 403 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = updateProfileSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid profile data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const nextEmail = parsed.data.email
  const emailChanged = nextEmail !== current.email
  if (emailChanged) {
    const existing = await findUserByEmail(nextEmail)
    if (existing && existing.id !== current.id) {
      return NextResponse.json(
        { message: "Email is already in use." },
        { status: 409 },
      )
    }
  }

  let updated
  try {
    updated = await updateUser(current.id, {
      fullName: parsed.data.fullName,
      email: nextEmail,
    })
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "Email is already in use." },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { message: "Unable to update your profile right now." },
      { status: 500 },
    )
  }

  if (!updated) {
    return NextResponse.json(
      { message: "Account no longer exists." },
      { status: 404 },
    )
  }

  if (emailChanged) {
    void syncUserMeta({
      userId: updated.id,
      email: updated.email,
      createdAt: updated.createdAt.toISOString(),
    })
  }

  const response = NextResponse.json({
    message: "Profile updated.",
    profile: {
      id: updated.id,
      fullName: updated.fullName,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
    },
  })

  // The session cookie carries the email claim, so we re-issue it whenever the
  // email changes; otherwise the header would keep rendering the old address
  // until the cookie expires (up to 7 days).
  if (emailChanged) {
    const token = await createSessionToken({
      sub: updated.id,
      role: updated.role,
      email: updated.email,
    })
    response.cookies.set(SESSION_COOKIE_NAME, token, buildSessionCookieConfig())
  }

  return response
}
