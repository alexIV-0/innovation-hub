import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  deleteDriveFile,
  downloadDriveFileMedia,
  getDriveFileInfo,
  GoogleDriveError,
  isDriveFileUnderFolder,
  isGoogleDriveConfigured,
  renameDriveFile,
} from "@/lib/google-drive"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-drive"
import {
  deleteProjectMediaByDriveFileId,
  findProjectForUser,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; fileId: string }> }

async function authorizeFile(
  request: NextRequest,
  context: RouteContext,
): Promise<
  | {
      project: NonNullable<Awaited<ReturnType<typeof findProjectForUser>>>
      fileId: string
    }
  | NextResponse
> {
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

  const under = await isDriveFileUnderFolder(fileId, project.driveFolderId)
  if (!under) {
    return NextResponse.json({ message: "File not found." }, { status: 404 })
  }

  return { project, fileId }
}

/** Download a Drive file that belongs to this project. */
export async function GET(request: NextRequest, context: RouteContext) {
  const authz = await authorizeFile(request, context)
  if (authz instanceof NextResponse) return authz

  try {
    const info = await getDriveFileInfo(authz.fileId)
    if (!info) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    if (info.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
      return NextResponse.json({ message: "Not found." }, { status: 404 })
    }

    const media = await downloadDriveFileMedia(authz.fileId)
    const headers = new Headers()
    headers.set("Content-Type", media.mimeType)
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(media.name)}`,
    )
    if (media.size != null) headers.set("Content-Length", String(media.size))

    return new NextResponse(media.body as unknown as BodyInit, {
      status: 200,
      headers,
    })
  } catch (error) {
    console.error("[project-drive] download failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to download file."
    return NextResponse.json({ message }, { status: 503 })
  }
}

/** Rename a Drive file/folder under this project. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const authz = await authorizeFile(request, context)
  if (authz instanceof NextResponse) return authz

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : ""
  if (!name || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }
  if (name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This name is reserved." },
      { status: 403 },
    )
  }

  try {
    const info = await getDriveFileInfo(authz.fileId)
    if (!info) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    if (info.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
      return NextResponse.json(
        { message: "This folder cannot be renamed." },
        { status: 403 },
      )
    }
    await renameDriveFile(authz.fileId, name)
    return NextResponse.json({ ok: true, name })
  } catch (error) {
    console.error("[project-drive] rename failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to rename."
    return NextResponse.json({ message }, { status: 503 })
  }
}

/**
 * Delete a file listed from the project's Drive folder (may have no local
 * media row when added outside the site UI). Allows nested files under IN/OUT.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const authz = await authorizeFile(request, context)
  if (authz instanceof NextResponse) return authz

  try {
    const info = await getDriveFileInfo(authz.fileId)
    if (!info) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    if (info.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
      return NextResponse.json(
        { message: "This folder cannot be deleted." },
        { status: 403 },
      )
    }

    await deleteDriveFile(authz.fileId)
  } catch (error) {
    console.error("[project-drive] file delete failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to delete file."
    return NextResponse.json({ message }, { status: 503 })
  }

  await deleteProjectMediaByDriveFileId(authz.fileId, authz.project.id)

  return NextResponse.json({ ok: true })
}
