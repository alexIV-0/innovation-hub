import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  readProjectBilling,
  updateProjectBilling,
} from "@/lib/billing/projects"
import { projectBillingPatchSchema } from "@/lib/billing/schemas"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/**
 * Настройки тарификации одного проекта: оси, ожидаемая оценка, признак шаблона.
 *
 * Правит админ, а не владелец проекта: цена — распоряжение владельца сервиса.
 * Оси здесь — запасной путь, главным остаётся объявленное в графе; но для
 * проектов, чей граф не переоткрывали, это единственный способ их задать.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await readProjectBilling(id)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return NextResponse.json({ project })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const parsed = projectBillingPatchSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const { payAxes, ...rest } = parsed.data
  const project = await updateProjectBilling({
    projectId: id,
    // Оси идут парой: задать базу без меры или наоборот означало бы оставить
    // проект в сочетании, которого нет в белом списке.
    ...(payAxes ? { payBase: payAxes.base, payMeter: payAxes.meter } : {}),
    ...rest,
  })

  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return NextResponse.json({ project })
}
