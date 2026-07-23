import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { GoogleDriveError, isGoogleDriveConfigured } from "@/lib/google-drive"
import {
  ProjectDriveStateError,
  setProjectAutomationEnabled,
  siteUpdatedBy,
} from "@/lib/project-drive"
import { updateFolderStateSchema } from "@/lib/project-schemas"
import { findProjectForUser, updateProject } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/** Toggle the automation switch: rewrites options/folderState.json on Drive. */
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
  const parsed = updateFolderStateSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid folder state payload." },
      { status: 400 },
    )
  }

  try {
    const folderState = await setProjectAutomationEnabled({
      driveFolderId: project.driveFolderId,
      enabled: parsed.data.enabled,
      updatedBy: siteUpdatedBy(auth.email),
    })

    // `folderState.json` on Drive is the source of truth for automation
    // on/off; mirror it into Postgres so list views can render the status
    // instantly without a Drive round trip per project (same idea as the
    // desktop app's LocalStorage cache in front of the file).
    await updateProject(id, auth.userId, {
      isActive: folderState.enabled,
    }).catch((cacheError) => {
      console.error("[project-drive] isActive cache sync failed", cacheError)
    })

    return NextResponse.json({ folderState })
  } catch (error) {
    if (error instanceof ProjectDriveStateError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[project-drive] folder state update failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to update automation state."
    return NextResponse.json({ message }, { status: 503 })
  }
}
