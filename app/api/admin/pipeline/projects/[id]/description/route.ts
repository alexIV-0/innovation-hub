import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { DESCRIPTION_SIZE_MAX } from "@/lib/markdown/description-format"
import {
  DESCRIPTION_FILE_NAME,
  projectDescriptionKey,
  readProjectDescriptionMd,
  writeProjectDescriptionMd,
} from "@/lib/project-storage"
import { findProjectById } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import { writeSidecarSync } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Развёрнутое описание проекта — options/description.md.
 *
 * Живёт в папке проекта, а не в БД: всё, что относится к проекту, лежит внутри
 * проекта, и десктопное приложение читает его оттуда же (экшен getSidecar с
 * name: description). Короткое описание в projects.description остаётся
 * отдельно — оно подпись на карточке в списке.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const body = await readProjectDescriptionMd(project.ownerId, project.id)
  // null, а не 404: отсутствие описания — обычное состояние проекта, а не ошибка.
  return NextResponse.json({ body })
}

const putSchema = z.object({
  // Предел взят из контракта, а не с потолка: одна картинка 1600 px в base64
  // (контракт §4) — это ~200 КБ, и прежние 200 000 символов отбивали бы 400 на
  // описании с парой картинок.
  body: z.string().max(DESCRIPTION_SIZE_MAX),
})

export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available." },
      { status: 409 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = putSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  try {
    await writeProjectDescriptionMd({
      userId: project.ownerId,
      projectId: project.id,
      body: parsed.data.body,
    })

    // Строка в каталоге плюс событие в журнале: без них файл на R2 поменялся бы
    // незаметно для машин, а сам сайдкар не появился бы в дереве проекта.
    await writeSidecarSync({
      userId: project.ownerId,
      projectId: project.id,
      key: projectDescriptionKey(project.ownerId, project.id),
      name: DESCRIPTION_FILE_NAME,
      actor: { userId: auth.userId },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("[pipeline] description write failed", error)
    return NextResponse.json(
      { message: "Failed to save description." },
      { status: 503 },
    )
  }
}
