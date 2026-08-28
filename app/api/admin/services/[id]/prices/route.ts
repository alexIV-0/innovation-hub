import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { addPriceSchema } from "@/lib/vault/schemas"
import { addPrice, findService } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Новая цена меры. Всегда добавление, никогда правка на месте.
 *
 * Прошлые строки остаются: по ним посчитаны уже случившиеся обработки, и
 * переписав цену задним числом, мы переписали бы историю расхода.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = addPriceSchema.safeParse(await request.json())
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

  await addPrice({
    serviceId: id,
    unit: parsed.data.unit,
    priceMicros: parsed.data.priceMicros,
    effectiveFrom: parsed.data.effectiveFrom
      ? new Date(parsed.data.effectiveFrom)
      : null,
    actorId: auth.userId,
  })

  await auditFrom(request, auth)({
    action: "service.updated",
    targetType: "service",
    targetId: id,
    targetLabel: service.name,
    meta: { price: parsed.data },
  })

  return NextResponse.json({ ok: true }, { status: 201 })
}
