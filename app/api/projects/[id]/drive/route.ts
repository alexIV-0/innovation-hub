import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createDriveFolder,
  GoogleDriveError,
  isDriveFileUnderFolder,
  isGoogleDriveConfigured,
} from "@/lib/google-drive"
import { loadProjectDriveState, OPTIONS_FOLDER_NAME } from "@/lib/project-drive"
import { findProjectForUser } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Live listing of the project's Google Drive folder. Files can appear there
 * outside of the site UI, so the cabinet reads Drive directly instead of
 * relying on the local media table. The service `options` folder is hidden.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  if (!isGoogleDriveConfigured() || !project.driveFolderId) {
    return NextResponse.json({ available: false })
  }

  try {
    const state = await loadProjectDriveState(project.driveFolderId)
    return NextResponse.json({
      available: true,
      driveFolderId: project.driveFolderId,
      ...state,
    })
  } catch (error) {
    console.error("[project-drive] listing failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to load project files from Google Drive."
    return NextResponse.json({ message }, { status: 503 })
  }
}

/** Create a subfolder inside the project Drive tree. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
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

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : ""
  const parentId =
    typeof body?.parentId === "string" && body.parentId
      ? body.parentId
      : project.driveFolderId

  if (!name || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
  }
  if (name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This folder name is reserved." },
      { status: 403 },
    )
  }

  const under = await isDriveFileUnderFolder(parentId, project.driveFolderId)
  if (!under) {
    return NextResponse.json({ message: "Invalid parent folder." }, { status: 400 })
  }

  try {
    const folderId = await createDriveFolder({
      name,
      parentId,
      reuseExisting: false,
    })
    return NextResponse.json({ id: folderId, name }, { status: 201 })
  } catch (error) {
    console.error("[project-drive] create folder failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to create folder."
    return NextResponse.json({ message }, { status: 503 })
  }
}
