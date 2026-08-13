import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { setProjectPaused } from "@/lib/project-automation"
import { ProjectStorageError, siteUpdatedBy } from "@/lib/project-storage"
import { findProjectById } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Тумблер слежения из админки. Тот же самый тумблер, что у пользователя в
 * кабинете: снятая галка здесь означает «На паузе» у него, и наоборот — это
 * решение обсуждалось и принято сознательно, отдельного админского запрета нет.
 *
 * Принимаем только isPaused: имя, название и архив проекта — дело владельца,
 * из «Конвейера» они не правятся.
 */
const patchSchema = z.object({
  isPaused: z.boolean(),
})

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  try {
    const { project: updated, folderState } = await setProjectPaused({
      projectId: project.id,
      ownerId: project.ownerId,
      paused: parsed.data.isPaused,
      updatedBy: siteUpdatedBy(auth.email),
    })
    return NextResponse.json({ project: updated, folderState })
  } catch (error) {
    if (error instanceof ProjectStorageError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[pipeline] pause update failed", error)
    return NextResponse.json(
      { message: "Failed to update automation state." },
      { status: 503 },
    )
  }
}
