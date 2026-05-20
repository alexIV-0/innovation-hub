import { NextResponse } from "next/server"
import { deleteAccountSchema } from "@/lib/account-schemas"
import { SESSION_COOKIE_NAME, verifyPassword } from "@/lib/auth"
import { getCurrentUser } from "@/lib/admin-auth"
import {
  countActiveAdmins,
  deleteUser,
  findUserByEmail,
} from "@/lib/repositories/users"

export async function DELETE(request: Request) {
  const current = await getCurrentUser()
  if (!current) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const payload = await request.json().catch(() => null)
  const parsed = deleteAccountSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Confirm your password to delete the account.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const full = await findUserByEmail(current.email)
  if (!full) {
    return NextResponse.json(
      { message: "Account no longer exists." },
      { status: 404 },
    )
  }

  const matches = await verifyPassword(parsed.data.currentPassword, full.passwordHash)
  if (!matches) {
    return NextResponse.json(
      { message: "Password is incorrect." },
      { status: 400 },
    )
  }

  // Refuse to leave the platform without an active admin — otherwise the
  // /admin surface becomes unreachable until someone touches the database.
  if (current.role === "ADMIN") {
    const remaining = await countActiveAdmins(current.id)
    if (remaining === 0) {
      return NextResponse.json(
        {
          message:
            "You are the last active admin. Promote another admin before deleting your account.",
        },
        { status: 409 },
      )
    }
  }

  await deleteUser(current.id)

  const response = NextResponse.json({ message: "Account deleted." })
  response.cookies.delete(SESSION_COOKIE_NAME)
  return response
}
