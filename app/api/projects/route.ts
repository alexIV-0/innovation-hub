import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { createProjectSchema } from "@/lib/project-schemas"
import { writeProjectMeta } from "@/lib/project-storage"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import { countProjectMembers } from "@/lib/repositories/project-member-counts"
import {
  createProject,
  deleteProject,
  listProjectsByUserId,
} from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const projects = await listProjectsByUserId(auth.userId)
  const ids = projects.map((p) => p.id)
  const [unread, memberCounts] = await Promise.all([
    countUnreadForProjects(ids),
    countProjectMembers(ids),
  ])

  return NextResponse.json({
    projects: projects.map((p) => ({
      ...p,
      ownerId: p.userId,
      isPaused: !p.isActive,
      unreadCount: unread[p.id] ?? 0,
      // Скольким людям расшарен проект — число в углу карточки.
      memberCount: memberCounts[p.id] ?? 0,
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
          "Cloudflare R2 is not configured. Set AWS_ENDPOINT_URL to your r2.cloudflarestorage.com endpoint plus AWS_S3_BUCKET / S3_KEY_ID / S3_SECRET_KEY.",
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
      userId: project.ownerId,
      projectId: project.id,
      name,
      description: description ?? "",
      ownerEmail: auth.email,
      createdAt: project.createdAt.toISOString(),
    })
  } catch (error) {
    console.error("[projects] failed to write project-meta.json to R2", error)
    await deleteProject(project.id, auth.userId).catch((cleanupError) => {
      console.error("[projects] rollback after R2 failure failed", cleanupError)
    })
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Cloudflare R2 is temporarily unavailable.",
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
