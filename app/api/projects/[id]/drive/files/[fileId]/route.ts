import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  deleteDriveFile,
  getDriveFileInfo,
  GoogleDriveError,
  isGoogleDriveConfigured,
} from "@/lib/google-drive"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-drive"
import {
  deleteProjectMediaByDriveFileId,
  findProjectForUser,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; fileId: string }> }

/**
 * Delete a file listed straight from the project's Drive folder (it may have
 * no local media row when it was added outside the site UI).
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isGoogleDriveConfigured() || !project.driveFolderId) {
    return NextResponse.json(
      { message: "Google Drive is not available for this project." },
      { status: 409 },
    )
  }

  try {
    const info = await getDriveFileInfo(fileId)
    // Only direct children of this project's folder can be deleted; this also
    // shields the service `options` folder contents from removal.
    if (!info || !info.parents.includes(project.driveFolderId)) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    if (info.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
      return NextResponse.json(
        { message: "This folder cannot be deleted." },
        { status: 403 },
      )
    }

    await deleteDriveFile(fileId)
  } catch (error) {
    console.error("[project-drive] file delete failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to delete file."
    return NextResponse.json({ message }, { status: 503 })
  }

  // Clean up the local media row when the file was uploaded through the UI.
  await deleteProjectMediaByDriveFileId(fileId, project.id)

  return NextResponse.json({ ok: true })
}
