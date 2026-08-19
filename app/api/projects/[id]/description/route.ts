import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { readProjectDescriptionMd } from "@/lib/project-storage"
import { findProjectForUser } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Развёрнутое описание проекта для кабинета — `options/description.md`.
 *
 * Только чтение, и это не упущение: описание — бриф от команды, его пишут в
 * программе или в админском «Конвейере», а владелец проекта читает. Отсюда же
 * отсутствие PUT: если он появится, у файла станет три писателя вместо двух, и
 * понадобится сверка версий (контракт §9), а нужды в этом пока нет.
 *
 * Короткая подпись проекта живёт отдельно, в `projects.description`: она нужна
 * на карточке в списке, и ходить за ней в объектное хранилище на каждый рендер
 * списка нельзя.
 *
 * Доступ — как у соседних роутов проекта: владелец или участник
 * (`findProjectForUser`). Ключ считается от `ownerId`, потому что папка проекта
 * лежит в префиксе владельца, а не того, кто смотрит.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const body = await readProjectDescriptionMd(project.ownerId, project.id)
  // null, а не 404: отсутствие описания — обычное состояние проекта, а не ошибка.
  return NextResponse.json({ body })
}
