import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createDriveFolder,
  GoogleDriveError,
  isGoogleDriveConfigured,
  writeDriveTextFile,
} from "@/lib/google-drive"
import { createProjectSchema } from "@/lib/project-schemas"
import { provisionUserDriveFolder } from "@/lib/provision-drive"
import {
  createProject,
  listProjectsByUserId,
  setProjectDriveFolderId,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const projects = await listProjectsByUserId(auth.userId)
  return NextResponse.json({
    projects,
    driveConfigured: isGoogleDriveConfigured(),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = createProjectSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Invalid project data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const { name, description } = parsed.data

  let driveFolderId: string | null = null

  if (isGoogleDriveConfigured()) {
    try {
      const userFolderId = await provisionUserDriveFolder(auth.userId)
      if (!userFolderId) {
        return NextResponse.json(
          {
            message:
              "Could not prepare your workspace. Please try again later.",
          },
          { status: 503 },
        )
      }

      // Never reuse a sibling folder: two projects with the same name must
      // not share Drive storage (uploads/deletes would leak across projects).
      driveFolderId = await createDriveFolder({
        name,
        parentId: userFolderId,
        reuseExisting: false,
      })

      // Leave a machine-readable brief for content-generation automations.
      await writeDriveTextFile({
        name: "project-meta.json",
        parentId: driveFolderId,
        mimeType: "application/json",
        content: JSON.stringify(
          {
            name,
            description,
            ownerEmail: auth.email,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      })
    } catch (error) {
      console.error("[projects] Drive folder create failed", error)
      const message =
        error instanceof GoogleDriveError
          ? error.message
          : "Storage is temporarily unavailable."
      return NextResponse.json({ message }, { status: 503 })
    }
  }

  const project = await createProject({
    userId: auth.userId,
    name,
    description,
    driveFolderId,
  })

  if (driveFolderId && !project.driveFolderId) {
    await setProjectDriveFolderId(project.id, driveFolderId)
  }

  return NextResponse.json(
    {
      ...project,
      driveFolderId: driveFolderId ?? project.driveFolderId,
    },
    { status: 201 },
  )
}
