import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  ProjectStorageError,
  setProjectAutomationEnabled,
  siteUpdatedBy,
} from "@/lib/project-storage"
import { updateFolderStateSchema } from "@/lib/project-schemas"
import { findProjectForUser, updateProject } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/** Toggle automation: rewrites options/folderState.json on R2. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available for this project." },
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
      projectId: project.id,
      enabled: parsed.data.enabled,
      updatedBy: siteUpdatedBy(auth.email),
    })

    await updateProject(id, auth.userId, {
      isActive: folderState.enabled,
    }).catch((cacheError) => {
      console.error("[project-storage] isActive cache sync failed", cacheError)
    })

    return NextResponse.json({ folderState })
  } catch (error) {
    if (error instanceof ProjectStorageError) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[project-storage] folder state update failed", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to update automation state.",
      },
      { status: 503 },
    )
  }
}
