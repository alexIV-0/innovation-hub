import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { updateAccountSchema } from "@/lib/vault/schemas"
import {
  deleteAccount,
  findAccountService,
  updateAccount,
} from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; accountId: string }> }

/**
 * Правка учётки и её отзыв.
 *
 * Отзыв — не удаление строки: по учётке считан прошлый расход (`vendor_usage`
 * ссылается на неё), и снеся её, мы оставили бы этот расход без адресата. Тот
 * же принцип, что у сервиса.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { accountId } = await context.params
  const parsed = updateAccountSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const found = await findAccountService(accountId)
  if (!found) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }

  const changed = await updateAccount(accountId, parsed.data)
  if (!changed) {
    return NextResponse.json({ message: "Nothing to update." }, { status: 400 })
  }

  await auditFrom(request, auth)({
    action: "service.account_updated",
    targetType: "service",
    targetId: found.service.id,
    targetLabel: `${found.service.name} / ${found.account.label}`,
    meta: parsed.data,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { accountId } = await context.params
  const found = await findAccountService(accountId)
  if (!found) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }

  /**
   * `?hard=1` — удалить насовсем, а не отозвать.
   *
   * Разрешено, только если по учётке ничего не потрачено: `vendor_usage`
   * ссылается на неё через `ON DELETE SET NULL`, и удаление осиротило бы
   * движения денег. Проверку делает репозиторий, а не этот роут: экран может
   * отстать от жизни на те секунды, за которые придёт отчёт о расходе.
   */
  if (request.nextUrl.searchParams.get("hard") === "1") {
    const result = await deleteAccount(accountId)
    if (!result.ok) {
      return NextResponse.json({ code: result.reason }, { status: 409 })
    }
    await auditFrom(request, auth)({
      action: "service.account_updated",
      targetType: "service",
      targetId: found.service.id,
      targetLabel: `${found.service.name} / ${found.account.label}`,
      meta: { deleted: true },
    })
    return NextResponse.json({ ok: true })
  }

  await updateAccount(accountId, { status: "revoked" })

  await auditFrom(request, auth)({
    action: "service.account_updated",
    targetType: "service",
    targetId: found.service.id,
    targetLabel: `${found.service.name} / ${found.account.label}`,
    meta: { status: "revoked" },
  })

  return NextResponse.json({ ok: true })
}
