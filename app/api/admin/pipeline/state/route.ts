import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { countPipelineTasksByStatus } from "@/lib/pipeline/tasks"
import { readPipelineState, setPipelineRunning } from "@/lib/pipeline/state"

export const runtime = "nodejs"

/**
 * Состояние конвейера для нижней полосы страницы.
 *
 * Выбирать пользователя или проект не нужно: слежение всегда идёт по всем
 * включённым пользователям и всем их непаузнутым непроектам-архивам сразу.
 * Кнопка на странице — это одно состояние на всю установку.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const [state, counts] = await Promise.all([
    readPipelineState(),
    countPipelineTasksByStatus(),
  ])
  return NextResponse.json({ state, counts })
}

const patchSchema = z.object({
  running: z.boolean(),
})

/**
 * Запуск — начать слежение за папками и сборку объектов для обработки.
 * Стоп — прекратить и то, и другое. Уже созданные задачи остаются в очереди.
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

  const state = await setPipelineRunning({
    running: parsed.data.running,
    adminUserId: auth.userId,
  })
  const counts = await countPipelineTasksByStatus()
  return NextResponse.json({ state, counts })
}
