import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { userUpdateSchema } from "@/lib/admin-schemas"
import { deleteUser, updateUser } from "@/lib/repositories/users"

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

  if (auth.userId === id && parsed.data.isActive === false) {
    return NextResponse.json(
      { message: "You cannot deactivate your own account." },
      { status: 400 },
    )
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

  await deleteUser(id)
  return NextResponse.json({ message: "User deleted." })
}
