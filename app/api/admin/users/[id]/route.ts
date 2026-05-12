import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { userUpdateSchema } from "@/lib/admin-schemas"
import {
  countActiveAdmins,
  deleteUser,
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

  const user = await updateUser(id, parsed.data)
  if (!user) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  return NextResponse.json(user)
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

  await deleteUser(id)
  return NextResponse.json({ message: "User deleted." })
}
