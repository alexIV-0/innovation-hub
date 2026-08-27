import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import {
  createRemoteComputer,
  generateRemoteComputerToken,
  listRemoteComputers,
} from "@/lib/repositories/remote-computers"

export const runtime = "nodejs"

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
})

function serializeComputer(
  row: Awaited<ReturnType<typeof listRemoteComputers>>[number],
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    online: row.online,
    currentProjectId: row.currentProjectId,
    currentProjectName: row.currentProjectName,
    currentTask: row.currentTask,
    machineUuid: row.machineUuid,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    meta: row.meta,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

/** List active remote computers (admin). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  const computers = await listRemoteComputers()
  return NextResponse.json({ computers: computers.map(serializeComputer) })
}

/** Create a remote computer. Raw token returned once. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "machines.manage")
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const raw = generateRemoteComputerToken()
  const created = await createRemoteComputer({
    name: parsed.data.name.trim(),
    description: parsed.data.description,
    createdBy: auth.userId,
    rawToken: raw,
  })

  // Выпуск rc_-токена — это выпуск кредов с доступом к общей очереди.
  // В журнал он идёт обязательно, независимо от того, кто его выпустил.
  await auditFrom(request, auth)({
    action: "computer.created",
    targetType: "computer",
    targetId: created.id,
    targetLabel: created.name,
  })

  return NextResponse.json(
    {
      id: created.id,
      name: created.name,
      token: created.token,
    },
    { status: 201 },
  )
}
