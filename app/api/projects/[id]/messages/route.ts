import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { createMessageSchema } from "@/lib/project-schemas"
import {
  createMessage,
  listMessages,
  markMessagesReadByUser,
} from "@/lib/repositories/project-messages"
import { findOwnedProject } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const messages = await listMessages(id)
  await markMessagesReadByUser(id)
  return NextResponse.json({ messages })
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createMessageSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const message = await createMessage({
    projectId: id,
    senderId: auth.userId,
    senderRole: "user",
    text: parsed.data.text,
  })

  return NextResponse.json({ message }, { status: 201 })
}
