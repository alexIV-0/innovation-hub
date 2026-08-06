import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createMachineToken,
  listMachineTokens,
  revokeMachineToken,
} from "@/lib/storage/auth"
import { generateMachineToken } from "@/lib/storage/write-path"
import { findOwnedProject } from "@/lib/repositories/projects"

export const runtime = "nodejs"

const createSchema = z.object({
  name: z.string().min(1).max(120),
  projectId: z.string().optional().nullable(),
})

/** List machine tokens for the signed-in user. */
export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth
  const tokens = await listMachineTokens(auth.userId)
  return NextResponse.json({ tokens })
}

/** Create a machine token. Raw token is returned once. */
export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
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

  if (parsed.data.projectId) {
    const project = await findOwnedProject(parsed.data.projectId, auth.userId)
    if (!project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
  }

  const raw = generateMachineToken()
  const created = await createMachineToken({
    userId: auth.userId,
    name: parsed.data.name,
    projectId: parsed.data.projectId ?? null,
    rawToken: raw,
  })

  return NextResponse.json(
    {
      id: created.id,
      token: created.token,
      name: parsed.data.name,
      projectId: parsed.data.projectId ?? null,
    },
    { status: 201 },
  )
}

/** Revoke a machine token: DELETE body { id }. */
export async function DELETE(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const id = typeof (body as { id?: unknown }).id === "string"
    ? (body as { id: string }).id
    : null
  if (!id) {
    return NextResponse.json({ message: "id is required." }, { status: 400 })
  }

  await revokeMachineToken(auth.userId, id)
  return NextResponse.json({ ok: true })
}
