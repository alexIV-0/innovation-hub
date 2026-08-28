import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  findMachineTokenById,
  revokeMachineTokenById,
} from "@/lib/storage/auth"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Отзыв машинного токена `mch_…` из админки.
 *
 * Право то же, что на список и на отзыв компьютера — `pipeline.operate`. Выпуск
 * токена живёт под `machines.manage`, потому что это выдача кредов, но отзыв —
 * стоп-кран: держать его строже показа значило бы показывать проблему тому, кто
 * не может её снять.
 *
 * Токен выпускает себе сам аккаунт (`POST /api/account/machine-tokens`), и до
 * этого роута снять чужой можно было только входом под чужим аккаунтом. Список
 * при этом общий — см. `listAccessTokens`.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const token = await findMachineTokenById(id)
  if (!token || token.revokedAt) {
    return NextResponse.json({ message: "Token not found." }, { status: 404 })
  }

  await revokeMachineTokenById(id)
  await auditFrom(request, auth)({
    action: "machine_token.revoked",
    targetType: "machine_token",
    targetId: id,
    // Подпись на момент события: строка «имя · почта владельца» — то, что видел
    // отзывавший на странице, а не id, по которому потом ничего не найти.
    targetLabel: `${token.name} · ${token.ownerEmail}`,
  })
  return NextResponse.json({ ok: true })
}
