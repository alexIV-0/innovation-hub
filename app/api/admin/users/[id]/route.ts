import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { userUpdateSchema } from "@/lib/admin-schemas"
import { hashPassword } from "@/lib/auth"
import { trashDriveFile } from "@/lib/google-drive"
import {
  countActiveAdmins,
  deleteUser,
  findUserByEmail,
  findUserById,
  updateUser,
} from "@/lib/repositories/users"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const payload = await request.json()
  const parsed = userUpdateSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid user payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const isSelf = auth.userId === id

  if (isSelf && parsed.data.isActive === false) {
    return NextResponse.json(
      { message: "You cannot deactivate your own account." },
      { status: 400 },
    )
  }

  if (isSelf && parsed.data.role === "USER") {
    return NextResponse.json(
      { message: "You cannot remove your own admin role." },
      { status: 400 },
    )
  }

  // Prevent dropping the last active admin via either role demotion or
  // deactivation of someone other than the caller.
  if (parsed.data.role === "USER" || parsed.data.isActive === false) {
    const target = await findUserById(id)
    if (target && target.role === "ADMIN" && target.isActive) {
      const remaining = await countActiveAdmins(id)
      if (remaining === 0) {
        return NextResponse.json(
          { message: "At least one active admin must remain." },
          { status: 400 },
        )
      }
    }
  }

  // Email change: lowercase, ensure no other account already uses it.
  let nextEmail: string | undefined
  if (parsed.data.email !== undefined) {
    nextEmail = parsed.data.email.toLowerCase()
    const conflict = await findUserByEmail(nextEmail)
    if (conflict && conflict.id !== id) {
      return NextResponse.json(
        { message: "Another account already uses this email." },
        { status: 409 },
      )
    }
  }

  // Password rotation: only hash when a non-empty value is provided.
  let nextPasswordHash: string | undefined
  if (parsed.data.password !== undefined && parsed.data.password.length > 0) {
    nextPasswordHash = await hashPassword(parsed.data.password)
  }

  try {
    const user = await updateUser(id, {
      fullName: parsed.data.fullName,
      email: nextEmail,
      passwordHash: nextPasswordHash,
      role: parsed.data.role,
      isActive: parsed.data.isActive,
    })

    if (!user) {
      return NextResponse.json({ message: "User not found." }, { status: 404 })
    }

    return NextResponse.json(user)
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "Another account already uses this email." },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { message: "Could not update user." },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  if (auth.userId === id) {
    return NextResponse.json(
      { message: "You cannot delete your own account." },
      { status: 400 },
    )
  }

  const target = await findUserById(id)
  if (target && target.role === "ADMIN" && target.isActive) {
    const remaining = await countActiveAdmins(id)
    if (remaining === 0) {
      return NextResponse.json(
        { message: "At least one active admin must remain." },
        { status: 400 },
      )
    }
  }

  // Trash (not permanently delete) the user's Drive folder so a future
  // signup with the same email gets a fresh folder instead of inheriting
  // this account's projects and files. Best-effort: Drive being down must
  // not block account deletion.
  if (target?.driveFolderId) {
    try {
      await trashDriveFile(target.driveFolderId)
    } catch (error) {
      console.error("[admin-users] failed to trash Drive folder", {
        userId: id,
        driveFolderId: target.driveFolderId,
        error,
      })
    }
  }

  await deleteUser(id)
  return NextResponse.json({ message: "User deleted." })
}
