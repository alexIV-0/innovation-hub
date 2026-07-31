import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { deleteDriveFile, GoogleDriveError } from "@/lib/google-drive"
import {
  deleteProjectMedia,
  findProjectForUser,
  findProjectMedia,
} from "@/lib/repositories/projects"

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

  const media = await findProjectMedia(mediaId, project.id)
  if (!media) {
    return NextResponse.json({ message: "Media not found." }, { status: 404 })
  }

  try {
    await deleteDriveFile(media.driveFileId)
  } catch (error) {
    console.error("[project-media] Drive delete failed", error)
    if (!(error instanceof GoogleDriveError)) {
      // Proceed with DB cleanup.
    }
  }

  await deleteProjectMedia(mediaId, project.id)
  return NextResponse.json({ ok: true })
}
