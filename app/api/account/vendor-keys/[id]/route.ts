import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { findOwnedAccount, updateAccount } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Отозвать свою учётку.
 *
 * Отзыв, а не удаление строки: на учётку ссылается прошлый расход
 * (`vendor_usage`), и снеся её, мы оставили бы его без адресата. Человеку
 * разницы не видно — учётка исчезает из списка, ключи по ней выдаваться
 * перестают, а до машин это доедет само: ревизия сейфа вырастет, и на
 * ближайшем пульсе они пойдут за ключами заново.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  // Владелец проверяется здесь и только здесь: без этой строки чужую учётку
  // можно было бы отозвать по прямому id.
  const owned = await findOwnedAccount(id, auth.userId)
  if (!owned) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }

  await updateAccount(id, { status: "revoked" })
  return NextResponse.json({ ok: true })
}
