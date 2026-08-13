import { NextResponse } from "next/server"
import { z } from "zod"
import { createProjectSchema } from "@/lib/project-schemas"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"
import {
  loadStorageProjectCatalog,
  serializeStorageProjectWithOwner,
} from "@/lib/storage/project-catalog"
import {
  createOwnedProject,
  isMutationError,
  renameOwnedProject,
  restoreOwnedProject,
  setOwnedProjectState,
  softDeleteOwnedProject,
} from "@/lib/storage/project-mutations"

async function projectResult(
  result:
    | Awaited<ReturnType<typeof renameOwnedProject>>
    | Awaited<ReturnType<typeof setOwnedProjectState>>,
  status = 200,
) {
  if (result instanceof NextResponse) return result
  if (isMutationError(result)) return apiError(result.error, result.status)
  return apiOk(
    { project: await serializeStorageProjectWithOwner(result.data) },
    status,
  )
}

export const projectsAction = defineAction(z.object({}), async (auth) => {
  const catalog = await loadStorageProjectCatalog(auth)
  if ("error" in catalog) return apiError(catalog.error, catalog.status)
  return apiOk(catalog)
})

export const createProjectAction = defineAction(
  createProjectSchema.extend({
    clientId: z.string().uuid().nullable().optional(),
  }),
  async (auth, props) => {
    const result = await createOwnedProject(auth, props)
    if (isMutationError(result)) return apiError(result.error, result.status)
    return apiOk(
      { project: await serializeStorageProjectWithOwner(result.data) },
      201,
    )
  },
)

export const projectRenameAction = defineAction(
  z.object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  }),
  async (auth, props) => projectResult(await renameOwnedProject(auth, props)),
)

export const projectStateAction = defineAction(
  z
    .object({
      projectId: z.string().uuid(),
      paused: z.boolean().optional(),
      archived: z.boolean().optional(),
    })
    .refine((d) => d.paused !== undefined || d.archived !== undefined, {
      message: "Provide paused and/or archived.",
    }),
  async (auth, props) => projectResult(await setOwnedProjectState(auth, props)),
)

export const deleteProjectAction = defineAction(
  z.object({ projectId: z.string().uuid() }),
  async (auth, props) => {
    const result = await softDeleteOwnedProject(auth, props)
    if (result instanceof NextResponse) return result
    if (isMutationError(result)) return apiError(result.error, result.status)
    return apiOk(result.data)
  },
)

export const restoreProjectAction = defineAction(
  z.object({ projectId: z.string().uuid() }),
  async (auth, props) => {
    const result = await restoreOwnedProject(auth, props)
    if (result instanceof NextResponse) return result
    if (isMutationError(result)) return apiError(result.error, result.status)
    return apiOk({
      project: await serializeStorageProjectWithOwner(result.data),
    })
  },
)
