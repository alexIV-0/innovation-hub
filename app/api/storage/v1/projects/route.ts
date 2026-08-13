import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"
import {
  listAllClients,
  listClientsByIds,
  listClientsByUserId,
} from "@/lib/repositories/clients"
import {
  findProjectById,
  listAllProjects,
  listProjectsByUserId,
} from "@/lib/repositories/projects"

export const runtime = "nodejs"

/**
 * GET /api/storage/v1/projects
 * Machine-token-friendly project + client catalog.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  if (auth.scopedProjectId) {
    const project = await findProjectById(auth.scopedProjectId)
    if (!project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
    if (auth.role !== "ADMIN" && project.userId !== auth.userId) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
    const clients = project.clientId
      ? await listClientsByIds([project.clientId])
      : []
    return NextResponse.json({
      clients: clients.map((c) => ({ id: c.id, displayName: c.displayName })),
      projects: [serializeProject(project)],
    })
  }

  const projects =
    auth.role === "ADMIN"
      ? await listAllProjects()
      : await listProjectsByUserId(auth.userId)

  const clients =
    auth.role === "ADMIN"
      ? await listAllClients()
      : await listClientsByUserId(auth.userId)

  return NextResponse.json({
    clients: clients.map((c) => ({ id: c.id, displayName: c.displayName })),
    projects: projects.map(serializeProject),
  })
}

function serializeProject(project: {
  id: string
  name: string
  clientId: string | null
  groupName: string
  isActive: boolean
  isPaused: boolean
  isArchived: boolean
  archivedAt: Date | null
  updatedAt: Date
}) {
  return {
    id: project.id,
    name: project.name,
    clientId: project.clientId,
    groupName: project.groupName,
    isActive: project.isActive,
    isPaused: project.isPaused,
    // Архивные проекты обработчик должен пропускать.
    isArchived: project.isArchived,
    archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
    updatedAt: project.updatedAt.toISOString(),
  }
}
