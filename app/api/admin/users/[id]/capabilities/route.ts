import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { ADMIN_CAPABILITIES } from "@/lib/admin-capabilities"
import { isSuperAdmin } from "@/lib/admin-roles"
import {
  listGrantsFor,
  setCapabilities,
} from "@/lib/repositories/admin-capabilities"
import { findUserById } from "@/lib/repositories/users"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

const putSchema = z.object({
  capabilities: z.array(z.enum(ADMIN_CAPABILITIES)).max(ADMIN_CAPABILITIES.length),
})

/** Что выдано человеку, кем и когда. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "users.read")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const grants = await listGrantsFor(id)

  return NextResponse.json({
    capabilities: grants.map((grant) => grant.capability),
    grants: grants.map((grant) => ({
      capability: grant.capability,
      grantedByEmail: grant.grantedByEmail,
      grantedAt: grant.grantedAt.toISOString(),
    })),
  })
}

/**
 * Заменить набор тегов целиком.
 *
 * Тег на этот роут — `users.read`, но им дело не ограничивается: выдача прав
 * это раздача доступа, а её даёт роль, а не тег. Будь здесь только тег, админ с
 * ним выписал бы себе всё остальное — и механизм тегов стал бы дырой вместо
 * ограничителя. См. docs/ADMIN_ROLES_PLAN.md §2.
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "users.read")
  if (auth instanceof NextResponse) return auth

  if (!isSuperAdmin(auth.role)) {
    return NextResponse.json(
      { message: "Only a superadmin can grant access." },
      { status: 403 },
    )
  }

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const target = await findUserById(id)
  if (!target) {
    return NextResponse.json({ message: "User not found." }, { status: 404 })
  }

  // Суперадмину теги не проверяются, поэтому и хранить их ему незачем: строки в
  // таблице стали бы вторым источником правды, который однажды разъедется с
  // первым. Обычному пользователю они не открывают ничего — тоже мимо.
  if (target.role !== "ADMIN") {
    return NextResponse.json(
      { message: "Access tags apply to admins only." },
      { status: 400 },
    )
  }

  const { added, removed } = await setCapabilities({
    userId: id,
    capabilities: parsed.data.capabilities,
    grantedBy: auth.userId,
  })

  const audit = auditFrom(request, auth)
  const targetRef = {
    targetType: "user",
    targetId: id,
    targetLabel: target.email,
  }
  if (added.length > 0) {
    await audit({ ...targetRef, action: "capability.granted", meta: { added } })
  }
  if (removed.length > 0) {
    await audit({
      ...targetRef,
      action: "capability.revoked",
      meta: { removed },
    })
  }

  return NextResponse.json({ capabilities: parsed.data.capabilities })
}
