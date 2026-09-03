import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { deletePrice, findService } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; priceId: string }> }

/**
 * Убрать цену из прайса.
 *
 * Разрешено, только если по ней ничего не считали: расход хранит применённое
 * `price_micros`, но объяснить, откуда оно взялось, после удаления строки будет
 * нечем. Ошибочно введённая цена, по которой ничего не прошло, удаляется
 * свободно — а это и есть частый случай.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { id, priceId } = await context.params
  const service = await findService(id)
  if (!service) {
    return NextResponse.json({ message: "Service not found." }, { status: 404 })
  }

  const price = service.prices.find((entry) => entry.id === priceId)
  if (!price) {
    return NextResponse.json({ message: "Price not found." }, { status: 404 })
  }

  const result = await deletePrice(priceId)
  if (!result.ok) {
    return NextResponse.json({ code: result.reason }, { status: 409 })
  }

  await auditFrom(request, auth)({
    action: "service.updated",
    targetType: "service",
    targetId: id,
    targetLabel: service.name,
    meta: { priceRemoved: price.unit, priceMicros: price.priceMicros },
  })

  return NextResponse.json({ ok: true })
}
