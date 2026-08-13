import { NextResponse } from "next/server"
import { z } from "zod"
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
import { apiError, apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"
import {
  requireProjectAccess,
  type StorageApiAuth,
} from "@/lib/storage/auth"
import { getDelta, getLatestCursor } from "@/lib/storage/changes"
import { loadStorageTree } from "@/lib/storage/tree"
import {
  getObjectText,
  projectFolderStateKey,
  projectOptionsKey,
} from "@/lib/project-storage"

function serializeProject(project: {
  id: string
  name: string
  clientId: string | null
  groupName: string
  isActive: boolean
  isPaused: boolean
  updatedAt: Date
}) {
  return {
    id: project.id,
    name: project.name,
    clientId: project.clientId,
    groupName: project.groupName,
    isActive: project.isActive,
    isPaused: project.isPaused,
    updatedAt: project.updatedAt.toISOString(),
  }
}

async function listVisibleProjects(auth: StorageApiAuth) {
  if (auth.scopedProjectId) {
    const project = await findProjectById(auth.scopedProjectId)
    if (!project) return apiError("Project not found.", 404)
    if (auth.role !== "ADMIN" && project.userId !== auth.userId) {
      return apiError("Project not found.", 404)
    }
    const clients = project.clientId
      ? await listClientsByIds([project.clientId])
      : []
    return apiOk({
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

  return apiOk({
    clients: clients.map((c) => ({ id: c.id, displayName: c.displayName })),
    projects: projects.map(serializeProject),
  })
}

export const capabilitiesAction = defineAction(z.object({}), async () =>
  apiOk({
    apiVersion: 1,
    multipart: false,
    rename: true,
    copy: false,
    sharing: false,
    clients: true,
    originMtime: true,
    contentHash: true,
  }),
)

export const projectsAction = defineAction(z.object({}), async (auth) =>
  listVisibleProjects(auth),
)

export const treeAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    prefix: z.string().optional().default(""),
  }),
  async (auth, props) => {
    const access = await requireProjectAccess(auth, props.projectId)
    if (access instanceof NextResponse) return access

    const [entries, cursor] = await Promise.all([
      loadStorageTree({ projectId: access.projectId, prefix: props.prefix }),
      getLatestCursor(access.projectId),
    ])
    return apiOk({ entries, cursor })
  },
)

export const deltaAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    since: z.number().int().nonnegative().optional().default(0),
  }),
  async (auth, props) => {
    const access = await requireProjectAccess(auth, props.projectId)
    if (access instanceof NextResponse) return access

    const delta = await getDelta({
      projectId: access.projectId,
      since: props.since,
    })
    return apiOk({
      changes: delta.changes.map((c) => ({
        seq: c.seq,
        op: c.op,
        key: c.key,
        projectId: c.projectId,
        name: c.payload.name ?? null,
        folderPath: c.payload.folderPath ?? null,
        isFolder: c.payload.isFolder ?? false,
        size: c.size,
        etag: c.etag,
        contentHash: c.contentHash,
        eventTime: c.eventTime,
        fileId: c.payload.fileId ?? null,
        contentType: c.payload.contentType ?? null,
      })),
      cursor: delta.cursor,
      truncated: delta.truncated,
    })
  },
)

export const getSidecarAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    name: z.enum(["folder-state", "options"]),
  }),
  async (auth, props) => {
    const access = await requireProjectAccess(auth, props.projectId)
    if (access instanceof NextResponse) return access

    const key =
      props.name === "folder-state"
        ? projectFolderStateKey(access.ownerId, access.projectId)
        : projectOptionsKey(access.ownerId, access.projectId)

    const text = await getObjectText(key)
    if (text == null) return apiError("Not found.", 404)
    return apiOk({ key, body: text })
  },
)
