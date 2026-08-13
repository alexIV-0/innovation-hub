import type { ProjectGroupName, ProjectRecord } from "@/lib/domain-types"
import { writeProjectMeta } from "@/lib/project-storage"
import { findClientById } from "@/lib/repositories/clients"
import {
  createProject,
  deleteProject,
  updateProject,
} from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import {
  requireOwnedProjectAccess,
  type StorageApiAuth,
} from "@/lib/storage/auth"
import { syncProjectMeta } from "@/lib/storage/project-catalog"
import { NextResponse } from "next/server"

export type MutationError = { error: string; status: number }
export type MutationOk<T> = { data: T }
export type MutationResult<T> = MutationOk<T> | MutationError

export function isMutationError<T>(
  result: MutationResult<T>,
): result is MutationError {
  return "error" in result
}

async function resolveClientId(
  auth: StorageApiAuth,
  clientId: string | null | undefined,
): Promise<MutationResult<string | null>> {
  if (clientId == null) return { data: null }
  const client = await findClientById(clientId)
  if (!client) return { error: "Client not found.", status: 400 }
  if (auth.role !== "ADMIN" && client.userId !== auth.userId) {
    return { error: "Client not found.", status: 400 }
  }
  return { data: client.id }
}

export async function createOwnedProject(
  auth: StorageApiAuth,
  input: {
    name: string
    description?: string
    groupName?: ProjectGroupName
    clientId?: string | null
  },
): Promise<MutationResult<ProjectRecord>> {
  if (auth.scopedProjectId) {
    return {
      error: "Scoped machine tokens cannot create projects.",
      status: 403,
    }
  }
  if (!isS3Configured()) {
    return { error: "Object storage is not configured.", status: 503 }
  }

  const client = await resolveClientId(auth, input.clientId)
  if (isMutationError(client)) return client

  const project = await createProject({
    userId: auth.userId,
    name: input.name,
    description: input.description,
    groupName: input.groupName,
    clientId: client.data,
  })

  try {
    await writeProjectMeta({
      userId: project.userId,
      projectId: project.id,
      name: project.name,
      description: project.description,
      ownerEmail: auth.email,
      isArchived: project.isArchived,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })
  } catch (error) {
    console.error("[storage] failed to write project-meta.json", error)
    await deleteProject(project.id, auth.userId).catch((cleanupError) => {
      console.error("[storage] rollback after R2 failure failed", cleanupError)
    })
    return {
      error:
        error instanceof Error
          ? error.message
          : "Object storage is temporarily unavailable.",
      status: 503,
    }
  }

  return { data: project }
}

export async function renameOwnedProject(
  auth: StorageApiAuth,
  input: { projectId: string; name: string },
): Promise<MutationResult<ProjectRecord> | NextResponse> {
  const access = await requireOwnedProjectAccess(auth, input.projectId)
  if (access instanceof NextResponse) return access

  const project = await updateProject(access.projectId, access.ownerId, {
    name: input.name,
  })
  if (!project) return { error: "Project not found.", status: 404 }
  await syncProjectMeta(project)
  return { data: project }
}

export async function setOwnedProjectState(
  auth: StorageApiAuth,
  input: { projectId: string; paused?: boolean; archived?: boolean },
): Promise<MutationResult<ProjectRecord> | NextResponse> {
  const access = await requireOwnedProjectAccess(auth, input.projectId)
  if (access instanceof NextResponse) return access

  const project = await updateProject(access.projectId, access.ownerId, {
    isPaused: input.paused,
    isArchived: input.archived,
  })
  if (!project) return { error: "Project not found.", status: 404 }
  if (input.archived !== undefined) {
    await syncProjectMeta(project)
  }
  return { data: project }
}

