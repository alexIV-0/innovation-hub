import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { hasCapability } from "@/lib/admin-capabilities"
import { auditFrom } from "@/lib/audit"
import { setProjectPaused } from "@/lib/project-automation"
import { ProjectStorageError, siteUpdatedBy } from "@/lib/project-storage"
import { findProjectById, updateProject } from "@/lib/repositories/projects"
import { syncProjectMeta } from "@/lib/storage/project-catalog"
import { softDeleteProject } from "@/lib/storage/project-trash"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Один роут, два тега — и это не небрежность, а суть §3 плана.
 *
 * `isPaused` — гейт обработки, им распоряжается `pipeline.operate`: тот же самый
 * тумблер, что у пользователя в кабинете. `name`, `description`, `isArchived` —
 * распоряжение чужим проектом, ступень 2 (`projects.manage`).
 *
 * Проверять по полям, а не по роуту, приходится потому, что оба набора приходят
 * одним PATCH из одной рабочей области. Разнести их по двум адресам значило бы
 * объяснять этот раздел клиенту дважды.
 */
const patchSchema = z
  .object({
    isPaused: z.boolean().optional(),
    name: z.string().trim().min(1).max(180).optional(),
    description: z.string().trim().max(2000).optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Nothing to update.",
  })

export async function PATCH(request: NextRequest, context: RouteContext) {
  // Гвард по самому мягкому из двух тегов; второй спрашиваем ниже, по полям.
  const auth = await requireAdminApi(request, "projects.access")
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

  const { isPaused, name, description, isArchived } = parsed.data
  const touchesProject =
    name !== undefined || description !== undefined || isArchived !== undefined

  if (
    isPaused !== undefined &&
    !hasCapability(auth.role, auth.capabilities, "pipeline.operate")
  ) {
    return NextResponse.json(
      { message: "Changing the processing gate requires pipeline access." },
      { status: 403 },
    )
  }
  if (
    touchesProject &&
    !hasCapability(auth.role, auth.capabilities, "projects.manage")
  ) {
    return NextResponse.json(
      { message: "Changing someone else's project requires project management." },
      { status: 403 },
    )
  }

  let updated = project
  if (touchesProject) {
    const next = await updateProject(project.id, project.ownerId, {
      name,
      description,
      isArchived,
    })
    if (!next) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
    updated = next
    await syncProjectMeta(updated)
  }

  // Пауза последней: она пишет в R2 и в журнал изменений, и делать это до
  // переименования значило бы разослать машинам сайдкар со старым именем.
  if (isPaused === undefined) {
    return NextResponse.json({ project: updated })
  }

  try {
    const { project: paused, folderState } = await setProjectPaused({
      projectId: updated.id,
      ownerId: updated.ownerId,
      storageOwnerId: updated.storageOwnerId,
      paused: isPaused,
      updatedBy: siteUpdatedBy(auth.email),
      actorUserId: auth.userId,
    })
    return NextResponse.json({ project: paused, folderState })
  } catch (error) {
    if (error instanceof ProjectStorageError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[workspaces] pause update failed", error)
    return NextResponse.json(
      { message: "Failed to update automation state." },
      { status: 503 },
    )
  }
}

/**
 * Удалить чужой проект — в корзину, а не насовсем: тот же `softDeleteProject`,
 * что в кабинете. Насовсем его убирает истечение срока хранения, и это
 * правильно: администратор, промахнувшийся строкой, должен иметь возможность
 * вернуть папку, а не объясняться.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectById(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const deleted = await softDeleteProject(project.id, project.ownerId)
  if (!deleted) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  await auditFrom(request, auth)({
    action: "project.deleted",
    targetType: "project",
    targetId: project.id,
    targetLabel: project.name,
    meta: { ownerId: project.ownerId, via: "workspaces" },
  })

  return NextResponse.json({ ok: true })
}
