import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { createProjectSchema } from "@/lib/project-schemas"
import { writeProjectMeta } from "@/lib/project-storage"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import {
  createProject,
  deleteProject,
  listProjectsByUserId,
} from "@/lib/repositories/projects"
import { listSharedProjectsForUser } from "@/lib/repositories/project-members"
import { listDeletedProjects } from "@/lib/storage/project-trash"
import { isS3Configured } from "@/lib/s3-client"

export const runtime = "nodejs"
export const maxDuration = 60

function parseArchivedParam(
  raw: string | null,
): { ok: true; value: boolean | "all" } | { ok: false } {
  if (raw == null || raw === "") return { ok: true, value: false }
  const value = raw.trim().toLowerCase()
  if (value === "all") return { ok: true, value: "all" }
  if (value === "true" || value === "1") return { ok: true, value: true }
  if (value === "false" || value === "0") return { ok: true, value: false }
  return { ok: false }
}

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const archived = parseArchivedParam(
    request.nextUrl.searchParams.get("archived"),
  )
  if (!archived.ok) {
    return NextResponse.json(
      { message: "archived must be true, false, or all." },
      { status: 400 },
    )
  }

  const [owned, shared, deleted] = await Promise.all([
    listProjectsByUserId(auth.userId, { archived: archived.value }),
    listSharedProjectsForUser(auth.userId),
    listDeletedProjects(auth.userId),
  ])

  const allIds = [
    ...owned.map((p) => p.id),
    ...shared.map((p) => p.id),
  ]
  const unread = await countUnreadForProjects(allIds)

  const projects = [
    ...owned.map((p) => ({
      ...p,
      ownerId: p.userId,
      isPaused: !p.isActive,
      unreadCount: unread[p.id] ?? 0,
      sharedWithMe: false,
      memberRole: null as null,
      deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    })),
    ...shared.map((p) => ({
      ...p,
      ownerId: p.userId,
      isPaused: !p.isActive,
      unreadCount: unread[p.id] ?? 0,
      sharedWithMe: true,
      memberRole: p.memberRole,
      deletedAt: null as string | null,
    })),
    ...deleted.map((p) => ({
      ...p,
      ownerId: p.userId,
      isPaused: !p.isActive,
      unreadCount: 0,
      sharedWithMe: false,
      memberRole: null as null,
      deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
    })),
  ]

  return NextResponse.json({
    projects,
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
      isArchived: project.isArchived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
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
