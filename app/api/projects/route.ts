import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createDriveFolder,
  formatDriveError,
  GoogleDriveError,
  isGoogleDriveConfigured,
  writeDriveTextFile,
} from "@/lib/google-drive"
import { createProjectSchema } from "@/lib/project-schemas"
import { listUserProjects } from "@/lib/project-drive"
import { provisionUserDriveFolder } from "@/lib/provision-drive"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import {
  createProject,
  setProjectDriveFolderId,
} from "@/lib/repositories/projects"
import { findUserById } from "@/lib/repositories/users"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  if (isGoogleDriveConfigured()) {
    const user = await findUserById(auth.userId)
    if (user && !user.driveFolderId) {
      await provisionUserDriveFolder(auth.userId)
    }
  }

  const fresh = await findUserById(auth.userId)
  const projects = await listUserProjects({
    userId: auth.userId,
    userDriveFolderId: fresh?.driveFolderId ?? null,
  })

  const unread = await countUnreadForProjects(projects.map((p) => p.id))

  return NextResponse.json({
    projects: projects.map((p) => ({
      ...p,
      ownerId: p.userId,
      isPaused: !p.isActive,
      unreadCount: unread[p.id] ?? 0,
    })),
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
        message: parsed.error.issues[0]?.message ?? "Invalid project data.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  const { name, description, groupName } = parsed.data

  let driveFolderId: string | null = null

  if (isGoogleDriveConfigured()) {
    try {
      const userFolderId = await provisionUserDriveFolder(auth.userId)
      if (!userFolderId) {
        return NextResponse.json(
          {
            message:
              "Could not prepare Google Drive workspace. The Drive refresh token may be expired — re-run `node scripts/google-drive-oauth.mjs`, update GOOGLE_DRIVE_REFRESH_TOKEN on the server, and restart.",
          },
          { status: 503 },
        )
      }

      driveFolderId = await createDriveFolder({
        name,
        parentId: userFolderId,
        reuseExisting: false,
      })

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

      // Default IN / OUT folders on Drive (options is created by automation).
      await Promise.all([
        createDriveFolder({
          name: "IN",
          parentId: driveFolderId,
          reuseExisting: true,
        }),
        createDriveFolder({
          name: "OUT",
          parentId: driveFolderId,
          reuseExisting: true,
        }),
      ])
    } catch (error) {
      console.error("[projects] Drive folder create failed", error)
      const message = formatDriveError(
        error instanceof GoogleDriveError ? error : error,
        "Storage is temporarily unavailable.",
      )
      return NextResponse.json({ message }, { status: 503 })
    }
  }

  const project = await createProject({
    userId: auth.userId,
    name,
    description,
    groupName,
    driveFolderId,
  })

  if (driveFolderId && !project.driveFolderId) {
    await setProjectDriveFolderId(project.id, driveFolderId)
  }

  return NextResponse.json(
    {
      project: {
        ...project,
        ownerId: project.userId,
        isPaused: !project.isActive,
        driveFolderId: driveFolderId ?? project.driveFolderId,
        unreadCount: 0,
      },
    },
    { status: 201 },
  )
}
