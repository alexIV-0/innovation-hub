import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { findFileById } from "@/lib/repositories/project-files"
import { findProjectForUser } from "@/lib/repositories/projects"
import { writeFileDelete } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; mediaId: string }>
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, mediaId } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const file = await findFileById(mediaId)
  if (!file || file.projectId !== project.id || file.isFolder) {
    return NextResponse.json({ message: "Media not found." }, { status: 404 })
  }

  await writeFileDelete({
    userId: project.ownerId,
    projectId: project.id,
    fileId: mediaId,
    deletedBy: auth.userId,
    actor: { userId: auth.userId },
  })

  return NextResponse.json({ ok: true })
}
