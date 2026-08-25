import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { markProjectChatRead } from "@/lib/repositories/project-chat"
import { requireProjectAccess } from "@/lib/project-access"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/** Marks a project's chat as read (clears its unread badge). */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const access = await requireProjectAccess(id, auth.userId)
  if (access instanceof NextResponse) return access
  const project = access.project

  await markProjectChatRead(project.id)
  return NextResponse.json({ ok: true })
}
