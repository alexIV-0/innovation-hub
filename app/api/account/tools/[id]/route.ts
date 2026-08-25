import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  deleteUserTool,
  findUserTool,
  updateUserTool,
} from "@/lib/repositories/user-tools"
import { updateToolSchema } from "@/lib/tool-schemas"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Правка экземпляра: имя, настройки, подключённый источник, порядок, отметка открытия. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = updateToolSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const tool = await updateUserTool(id, auth.userId, parsed.data)
  if (!tool) return NextResponse.json({ message: "Tool not found." }, { status: 404 })
  return NextResponse.json({ tool })
}

/** Убрать инструмент у пользователя. Мягкое удаление: настройки не теряются. */
export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  const existing = await findUserTool(id, auth.userId)
  if (!existing) return NextResponse.json({ message: "Tool not found." }, { status: 404 })

  await deleteUserTool(id, auth.userId)
  return NextResponse.json({ ok: true })
}
