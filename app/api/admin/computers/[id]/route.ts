import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  findRemoteComputerById,
  isRemoteComputerOnline,
  revokeRemoteComputer,
  updateRemoteComputer,
} from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
})

type RouteContext = { params: Promise<{ id: string }> }

/** Update computer name/description. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const updated = await updateRemoteComputer(id, parsed.data)
  if (!updated) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    description: updated.description,
    status: updated.status,
    online: isRemoteComputerOnline(updated.lastHeartbeatAt, updated.revokedAt),
    currentProjectId: updated.currentProjectId,
    currentTask: updated.currentTask,
    lastHeartbeatAt: updated.lastHeartbeatAt?.toISOString() ?? null,
    meta: updated.meta,
    createdBy: updated.createdBy,
    createdAt: updated.createdAt.toISOString(),
  })
}

/** Revoke a computer token (soft delete). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  await revokeRemoteComputer(id)
  await auditFrom(request, auth)({
    action: "computer.revoked",
    targetType: "computer",
    targetId: id,
    targetLabel: existing.name,
  })
  return NextResponse.json({ ok: true })
}
