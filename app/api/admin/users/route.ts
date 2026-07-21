import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { userCreateSchema } from "@/lib/admin-schemas"
import { hashPassword } from "@/lib/auth"
import { provisionUserDriveFolderBackground } from "@/lib/provision-drive"
import {
  createUser,
  findUserByEmail,
  listUsers,
  updateUser,
} from "@/lib/repositories/users"

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const users = await listUsers()
  return NextResponse.json(users)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json()
  const parsed = userCreateSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid user payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const email = parsed.data.email.toLowerCase()
  const existing = await findUserByEmail(email)
  if (existing) {
    return NextResponse.json(
      { message: "User with this email already exists." },
      { status: 409 },
    )
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password)
    const user = await createUser({
      fullName: parsed.data.fullName,
      email,
      passwordHash,
      role: parsed.data.role,
    })

    provisionUserDriveFolderBackground(user.id)

    // createUser doesn't take isActive (DB default = TRUE) — branch into a
    // follow-up UPDATE only if the caller explicitly created an inactive user.
    if (parsed.data.isActive === false) {
      const updated = await updateUser(user.id, { isActive: false })
      return NextResponse.json(updated ?? user, { status: 201 })
    }

    return NextResponse.json(user, { status: 201 })
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
    ) {
      return NextResponse.json(
        { message: "User with this email already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json(
      { message: "Could not create user." },
      { status: 500 },
    )
  }
}
