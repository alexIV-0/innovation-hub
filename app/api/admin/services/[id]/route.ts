import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { updateServiceSchema } from "@/lib/vault/schemas"
import { findService, updateService } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Правка сервиса и его отзыв.
 *
 * Отзыв — не удаление строки: по ней считаны прошлые обработки, и снеся её, мы
 * оставили бы расход без адресата. Поэтому `status = revoked`, и выдача ключей
 * прекращается тем же признаком.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = updateServiceSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const service = await findService(id)
  if (!service) {
    return NextResponse.json({ message: "Service not found." }, { status: 404 })
  }

  const changed = await updateService(id, parsed.data)
  if (!changed) {
    return NextResponse.json({ message: "Nothing to update." }, { status: 400 })
  }

  await auditFrom(request, auth)({
    action: "service.updated",
    targetType: "service",
    targetId: id,
    targetLabel: service.name,
    meta: parsed.data,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const service = await findService(id)
  if (!service) {
    return NextResponse.json({ message: "Service not found." }, { status: 404 })
  }

  await updateService(id, { status: "revoked" })

  await auditFrom(request, auth)({
    action: "service.updated",
    targetType: "service",
    targetId: id,
    targetLabel: service.name,
    meta: { status: "revoked" },
  })

  return NextResponse.json({ ok: true })
}
