import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createUserTool,
  listUserTools,
} from "@/lib/repositories/user-tools"
import { createToolSchema } from "@/lib/tool-schemas"
import { findTool } from "@/lib/tools/registry"

export const runtime = "nodejs"

/** Инструменты, которые пользователь добавил себе. */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const tools = await listUserTools(auth.userId)
  return NextResponse.json({ tools })
}

/** Добавить инструмент из каталога. */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createToolSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const definition = findTool(parsed.data.toolKey)
  if (!definition) {
    return NextResponse.json({ message: "Unknown tool." }, { status: 404 })
  }
  // Инструмент со статусом `soon` в каталоге видно, но добавить нельзя:
  // страница это уже не даёт, а роут не должен верить странице.
  if (definition.status !== "ready") {
    return NextResponse.json({ message: "Tool is not available yet." }, { status: 409 })
  }

  const tool = await createUserTool({
    userId: auth.userId,
    toolKey: definition.key,
    defaults: definition.defaults,
  })
  return NextResponse.json({ tool }, { status: 201 })
}
