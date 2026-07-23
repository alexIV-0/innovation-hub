import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { GoogleDriveError, isGoogleDriveConfigured } from "@/lib/google-drive"
import {
  ProjectDriveStateError,
  updateProjectExposedOptions,
} from "@/lib/project-drive"
import { updateExposedOptionsSchema } from "@/lib/project-schemas"
import { findProjectForUser } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Save edits to automation parameters exposed to the site
 * (`exposedToSite: true` entries in options/options.json).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

  const payload = await request.json().catch(() => null)
  const parsed = updateExposedOptionsSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid options payload." },
      { status: 400 },
    )
  }

  try {
    const options = await updateProjectExposedOptions({
      driveFolderId: project.driveFolderId,
      changes: parsed.data.changes,
    })
    return NextResponse.json({ options })
  } catch (error) {
    if (error instanceof ProjectDriveStateError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[project-drive] options update failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to update automation options."
    return NextResponse.json({ message }, { status: 503 })
  }
}
