import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireUserApi } from "@/lib/admin-auth"
import { VaultKeyError } from "@/lib/vault/crypto"
import { findOwnedAccount, rotateAccountSecret } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const rotateSchema = z.object({
  fields: z.record(z.string().trim().min(1).max(48), z.string().min(1).max(8192)),
})

/**
 * Заменить секрет своей учётки.
 *
 * Прежняя версия остаётся живой до отдельного решения — так же, как у
 * студийных ключей: задачи, которые уже держат её копию, иначе упали бы
 * посреди работы. Гасит их админ, когда парк успел обновиться; человеку эта
 * механика не показывается, ему достаточно «ключ заменён».
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const owned = await findOwnedAccount(id, auth.userId)
  if (!owned) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = rotateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const version = await rotateAccountSecret({
      accountId: id,
      fields: parsed.data.fields,
      actorId: auth.userId,
    })
    if (version == null) {
      return NextResponse.json({ message: "Account not found." }, { status: 404 })
    }
    return NextResponse.json({ version })
  } catch (error) {
    if (error instanceof VaultKeyError) {
      return NextResponse.json({ code: "vault-not-configured" }, { status: 503 })
    }
    throw error
  }
}
