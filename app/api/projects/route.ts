import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { createProjectSchema } from "@/lib/project-schemas"
import { writeProjectMeta } from "@/lib/project-storage"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import { createProject, listProjectsByUserId } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const projects = await listProjectsByUserId(auth.userId)
  const unread = await countUnreadForProjects(projects.map((p) => p.id))

  return NextResponse.json({
    projects: projects.map((p) => ({
      ...p,
      ownerId: p.userId,
      isPaused: !p.isActive,
      unreadCount: unread[p.id] ?? 0,
    })),
    storageConfigured: isS3Configured(),
    driveConfigured: false,
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

  if (!isS3Configured()) {
    return NextResponse.json(
      {
        message:
          "Object storage is not configured. Set AWS_S3_BUCKET and S3 credentials.",
      },
      { status: 503 },
    )
  }

  const project = await createProject({
    userId: auth.userId,
    name,
    description,
    groupName,
  })

  try {
    await writeProjectMeta({
      projectId: project.id,
      name,
      description: description ?? "",
      ownerEmail: auth.email,
      createdAt: project.createdAt.toISOString(),
    })
  } catch (error) {
    console.error("[projects] failed to write project-meta.json", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Storage is temporarily unavailable.",
      },
      { status: 503 },
    )
  }

  return NextResponse.json(
    {
      project: {
        ...project,
        ownerId: project.userId,
        isPaused: !project.isActive,
        unreadCount: 0,
      },
    },
    { status: 201 },
  )
}
