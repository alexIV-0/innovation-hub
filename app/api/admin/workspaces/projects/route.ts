import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listPipelineProjectsByOwner } from "@/lib/pipeline/repository"

export const runtime = "nodejs"

/**
 * Колонка 2 «Конвейера»: проекты выбранного пользователя.
 *
 * Архивные приходят вместе с остальными и помечены isArchived — админ должен их
 * видеть и понимать, что они не обрабатываются. Расшаренность не показываем:
 * проект принадлежит владельцу, а кто ещё с ним работает — не вопрос конвейера.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const userId = request.nextUrl.searchParams.get("userId")
  if (!userId) {
    // Пользователь не выбран — пустой список, а не ошибка: страница
    // открывается до того, как в колонке 1 что-то нажали.
    return NextResponse.json({ projects: [] })
  }

  const projects = await listPipelineProjectsByOwner(userId)
  return NextResponse.json({ projects })
}
