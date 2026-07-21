import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { deleteDriveFile, GoogleDriveError } from "@/lib/google-drive"
import { updateProjectSchema } from "@/lib/project-schemas"
import {
  deleteProject,
  findProjectForUser,
  listProjectMedia,
  updateProject,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const media = await listProjectMedia(project.id)
  return NextResponse.json({ project, media })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const payload = await request.json().catch(() => null)
  const parsed = updateProjectSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid project data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const updated = await updateProject(id, auth.userId, parsed.data)
  if (!updated) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  return NextResponse.json(updated)
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  // Soft-clean Drive folder when possible; DB cascade removes media rows.
  if (project.driveFolderId) {
    try {
      await deleteDriveFile(project.driveFolderId)
    } catch (error) {
      console.error("[projects] Drive folder delete failed", error)
      if (!(error instanceof GoogleDriveError)) {
        // Continue — local delete still matters.
      }
    }
  }

  await deleteProject(id, auth.userId)
  return NextResponse.json({ ok: true })
}
