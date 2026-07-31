import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { GoogleDriveError, isGoogleDriveConfigured } from "@/lib/google-drive"
import { loadProjectDriveState } from "@/lib/project-drive"
import { findProjectForUser } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Live listing of the project's Google Drive folder. Files can appear there
 * outside of the site UI, so the cabinet reads Drive directly instead of
 * relying on the local media table.
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
    return NextResponse.json({ available: true, ...state })
  } catch (error) {
    console.error("[project-drive] listing failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to load project files from Google Drive."
    return NextResponse.json({ message }, { status: 503 })
  }
}
