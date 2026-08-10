import { NextResponse, type NextRequest } from "next/server"
import { requireRemoteComputerApi } from "@/lib/storage/auth"
import {
  findRemoteComputerById,
  isRemoteComputerOnline,
} from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

/** Identity and presence for the authenticated remote computer. */
export async function GET(request: NextRequest) {
  const auth = await requireRemoteComputerApi(request)
  if (auth instanceof NextResponse) return auth

  const computer = await findRemoteComputerById(auth.computerId)
  if (!computer || computer.revokedAt) {
    return NextResponse.json({ message: "Computer not found." }, { status: 404 })
  }

  return NextResponse.json({
    id: computer.id,
    name: computer.name,
    description: computer.description,
    status: computer.status,
    online: isRemoteComputerOnline(computer.lastHeartbeatAt, computer.revokedAt),
    currentProjectId: computer.currentProjectId,
    currentTask: computer.currentTask,
    lastHeartbeatAt: computer.lastHeartbeatAt?.toISOString() ?? null,
    meta: computer.meta,
    createdAt: computer.createdAt.toISOString(),
  })
}
