import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { transferProject, type TransferRefusal } from "@/lib/project-transfer"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const bodySchema = z.object({ toUserId: z.string().min(1) })

/**
 * Ответы на отказы разведены по смыслу, а не свалены в общее «нельзя».
 *
 * Человек, которому отказали, должен понять, что делать дальше: разблокировать
 * аккаунт, дождаться конца тестового периода или просто выбрать другого. Общее
 * сообщение отправило бы его искать поломку.
 */
const REFUSAL: Record<TransferRefusal, { message: string; status: number }> = {
  "not-found": { message: "Project not found.", status: 404 },
  "same-owner": { message: "The project already belongs to this person.", status: 400 },
  "target-not-found": { message: "Recipient not found.", status: 404 },
  "target-inactive": {
    message: "Recipient's account is suspended.",
    status: 409,
  },
  granted: {
    message:
      "This project is paid for by a gift. Close the gift before handing the project over.",
    status: 409,
  },
}

/**
 * Передать проект другому пользователю — ступень 2 (`projects.manage`).
 *
 * После переноса проект исчезает у прежнего владельца и появляется у нового.
 * Нужен доступ обратно — прежнего владельца расшаривают как участника; в его
 * кабинете проект встанет в «Расшаренные». Разбор — docs/ADMIN_WORKSPACE_PLAN.md §5.0.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "projects.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const result = await transferProject({
    projectId: id,
    toUserId: parsed.data.toUserId,
  })

  if (!result.ok) {
    const refusal = REFUSAL[result.reason]
    return NextResponse.json(
      { message: refusal.message, reason: result.reason },
      { status: refusal.status },
    )
  }

  await auditFrom(request, auth)({
    action: "project.transferred",
    targetType: "project",
    targetId: result.project.id,
    targetLabel: result.project.name,
    meta: {
      from: result.from?.email ?? result.from?.id ?? null,
      to: result.to.email,
      // Адрес байтов не менялся — записываем, чтобы потом не гадать, почему
      // ключи проекта лежат под третьим человеком.
      storageOwnerId: result.project.storageOwnerId,
    },
  })

  return NextResponse.json({ project: result.project })
}
