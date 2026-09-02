import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { listAccountTasks } from "@/lib/pipeline/account-tasks"

export const runtime = "nodejs"

/**
 * Обработка глазами человека: его файлы, их состояния, доля пройденных шагов.
 *
 * ⚠️ Это НЕ урезанная копия `/api/admin/pipeline/tasks`. Тот роут отвечает на
 * вопрос «что происходит в парке машин», этот — «что с моим файлом». Разные
 * вопросы, разные поля, и намеренно разные файлы: общий обработчик с ветвлением
 * по роли однажды отдал бы наружу текст ошибки плагина или имя машины.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({ tasks: await listAccountTasks(auth.userId) })
}
