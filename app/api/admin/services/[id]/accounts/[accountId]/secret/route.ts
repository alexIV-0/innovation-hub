import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { VaultKeyError } from "@/lib/vault/crypto"
import { rotateAccountSecretSchema } from "@/lib/vault/schemas"
import {
  findAccountService,
  revokeOldAccountSecrets,
  rotateAccountSecret,
} from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; accountId: string }> }

/**
 * Ротация секрета учётки и гашение прежних версий.
 *
 * Две операции, а не одна, и это намеренно: новая версия появляется сразу, а
 * старая живёт до отдельного решения. Погаси мы её тем же движением — задачи,
 * которые уже держат её копию, упали бы посреди работы.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { accountId } = await context.params
  const parsed = rotateAccountSecretSchema.safeParse(await request.json())
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

  try {
    const version = await rotateAccountSecret({
      accountId,
      fields: parsed.data.fields,
      actorId: auth.userId,
    })
    if (version == null) {
      return NextResponse.json({ message: "Account not found." }, { status: 404 })
    }

    await auditFrom(request, auth)({
      action: "service.secret_rotated",
      targetType: "service",
      targetId: found.service.id,
      targetLabel: `${found.service.name} / ${found.account.label}`,
      meta: { account: found.account.label, version },
    })

    return NextResponse.json({ version })
  } catch (error) {
    if (error instanceof VaultKeyError) {
      return NextResponse.json({ code: "vault-not-configured" }, { status: 503 })
    }
    throw error
  }
}

/** Погасить все версии, кроме старшей. Делается, когда парк успел обновиться. */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { accountId } = await context.params
  const found = await findAccountService(accountId)
  if (!found) {
    return NextResponse.json({ message: "Account not found." }, { status: 404 })
  }

  const revoked = await revokeOldAccountSecrets(accountId)

  await auditFrom(request, auth)({
    action: "service.secrets_revoked",
    targetType: "service",
    targetId: found.service.id,
    targetLabel: `${found.service.name} / ${found.account.label}`,
    meta: { account: found.account.label, revoked },
  })

  return NextResponse.json({ revoked })
}
