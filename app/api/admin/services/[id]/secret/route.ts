import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { VaultKeyError } from "@/lib/vault/crypto"
import { rotateSecretSchema } from "@/lib/vault/schemas"
import { findService, revokeOldSecrets, rotateSecret } from "@/lib/vault/services"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Ротация ключа и гашение прежних версий.
 *
 * Две операции, а не одна, и это намеренно: новая версия появляется сразу, а
 * старая живёт до отдельного решения. Погаси мы её тем же движением — задачи,
 * которые уже держат её копию, упали бы посреди работы.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const parsed = rotateSecretSchema.safeParse(await request.json())
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

  try {
    const version = await rotateSecret({
      serviceId: id,
      secret: parsed.data.secret,
      actorId: auth.userId,
    })
    if (version == null) {
      return NextResponse.json({ message: "Service not found." }, { status: 404 })
    }

    await auditFrom(request, auth)({
      action: "service.secret_rotated",
      targetType: "service",
      targetId: id,
      targetLabel: service.name,
      meta: { version },
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

  const { id } = await context.params
  const service = await findService(id)
  if (!service) {
    return NextResponse.json({ message: "Service not found." }, { status: 404 })
  }

  const revoked = await revokeOldSecrets(id)

  await auditFrom(request, auth)({
    action: "service.secrets_revoked",
    targetType: "service",
    targetId: id,
    targetLabel: service.name,
    meta: { revoked },
  })

  return NextResponse.json({ revoked })
}
