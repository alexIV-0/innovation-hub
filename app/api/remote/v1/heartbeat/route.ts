import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireRemoteComputerApi } from "@/lib/storage/auth"
import { findProjectById } from "@/lib/repositories/projects"
import {
  heartbeatRemoteComputer,
  isRemoteComputerOnline,
} from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

const heartbeatSchema = z.object({
  status: z.enum(["idle", "busy", "error"]).optional(),
  currentProjectId: z.string().nullable().optional(),
  currentTask: z.string().max(500).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

/** Report presence and optional work status. Updates last_heartbeat_at. */
export async function POST(request: NextRequest) {
  const auth = await requireRemoteComputerApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown = {}
  const contentType = request.headers.get("content-type") ?? ""
  if (contentType.includes("application/json")) {
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
    }
  }

  const parsed = heartbeatSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  if (
    parsed.data.currentProjectId !== undefined &&
    parsed.data.currentProjectId !== null
  ) {
    const project = await findProjectById(parsed.data.currentProjectId)
    if (!project) {
      return NextResponse.json(
        { message: "Project not found." },
        { status: 404 },
      )
    }
  }

  const updated = await heartbeatRemoteComputer(auth.computerId, {
    status: parsed.data.status,
    currentProjectId: parsed.data.currentProjectId,
    currentTask: parsed.data.currentTask,
    meta: parsed.data.meta,
  })

  if (!updated) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    status: updated.status,
    online: isRemoteComputerOnline(updated.lastHeartbeatAt, updated.revokedAt),
    currentProjectId: updated.currentProjectId,
    currentTask: updated.currentTask,
    lastHeartbeatAt: updated.lastHeartbeatAt?.toISOString() ?? null,
    meta: updated.meta,
  })
}
