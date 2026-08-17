import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  cancelPipelineTask,
  countPipelineTasksByStatus,
  deletePipelineTask,
  listPipelineTasks,
} from "@/lib/pipeline/tasks"

export const runtime = "nodejs"

/** Очередь задач: что нашлось, кто взял, в каком состоянии. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const [tasks, counts] = await Promise.all([
    listPipelineTasks(),
    countPipelineTasksByStatus(),
  ])
  return NextResponse.json({ tasks, counts })
}

const taskIdSchema = z.object({ taskId: z.string().min(1) })

/**
 * Снять задачу — пометить `failed` с причиной «снята администратором».
 *
 * Именно снять, а не удалить: удаление строки вернуло бы элемент в поле зрения
 * страховочного обхода, и задача по тому же файлу появилась бы снова. Для этого
 * есть отдельный DELETE ниже — там это осознанный выбор.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = taskIdSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ message: "Invalid input." }, { status: 400 })
  }

  const cancelled = await cancelPipelineTask({
    taskId: parsed.data.taskId,
    reason: `Снята администратором (${auth.email ?? auth.userId}).`,
  })
  if (!cancelled) {
    return NextResponse.json(
      { message: "Task not found or already failed." },
      { status: 404 },
    )
  }

  const [tasks, counts] = await Promise.all([
    listPipelineTasks(),
    countPipelineTasksByStatus(),
  ])
  return NextResponse.json({ tasks, counts })
}

/**
 * Удалить строку задачи насовсем.
 *
 * Последствие называем прямо, потому что оно неочевидно: если элемент всё ещё
 * лежит в папке IN, обход перестанет считать его известным и заведёт задачу
 * заново. Это и есть смысл удаления — «забудь и найди с нуля».
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const taskId = request.nextUrl.searchParams.get("taskId")
  if (!taskId) {
    return NextResponse.json({ message: "taskId is required." }, { status: 400 })
  }

  const deleted = await deletePipelineTask(taskId)
  if (!deleted) {
    return NextResponse.json({ message: "Task not found." }, { status: 404 })
  }

  const [tasks, counts] = await Promise.all([
    listPipelineTasks(),
    countPipelineTasksByStatus(),
  ])
  return NextResponse.json({ tasks, counts })
}
