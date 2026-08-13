import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { listPipelineUsers } from "@/lib/pipeline/repository"
import { setUserAutomationEnabled } from "@/lib/repositories/users"

export const runtime = "nodejs"

/**
 * Колонка 1 «Конвейера»: пользователи и их участие в обработке.
 *
 * Возвращает не только флаг, но и счётчики по проектам — админу нужно понимать,
 * почему у включённого пользователя ничего не обрабатывается: все проекты на
 * паузе, все в архиве или ни в одном нет options.json.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const users = await listPipelineUsers()
  return NextResponse.json({ users })
}

const patchSchema = z.object({
  userId: z.string().min(1),
  automationEnabled: z.boolean(),
})

/**
 * Гейт уровня пользователя. Флаги его проектов не трогаем осознанно: выключил
 * и включил обратно — состояние проектов осталось тем, каким его оставил
 * пользователь.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const user = await setUserAutomationEnabled(
    parsed.data.userId,
    parsed.data.automationEnabled,
  )
  if (!user) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  return NextResponse.json({
    user: {
      id: user.id,
      automationEnabled: user.automationEnabled,
    },
  })
}
