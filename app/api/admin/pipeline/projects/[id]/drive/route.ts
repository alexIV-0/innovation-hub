import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { loadProjectStorageState } from "@/lib/project-storage"
import { findProjectById } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Колонка 3 «Конвейера»: дерево проекта целиком, вместе со служебной папкой
 * options — в кабинете пользователя она скрыта, админ работает именно с ней.
 *
 * Скоупинга по владельцу нет намеренно: администратор смотрит любые проекты,
 * поэтому findProjectById, а не findProjectForUser.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  try {
    const state = await loadProjectStorageState(project.ownerId, project.id, {
      includeServiceFiles: true,
    })
    return NextResponse.json({
      ...state,
      storageAvailable: state.available,
    })
  } catch (error) {
    console.error("[pipeline] admin listing failed", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load project files.",
      },
      { status: 503 },
    )
  }
}
