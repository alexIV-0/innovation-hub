import { z } from "zod"
import { findProjectById } from "@/lib/repositories/projects"
import {
  findRemoteComputerById,
  heartbeatRemoteComputer,
  isRemoteComputerOnline,
} from "@/lib/repositories/remote-computers"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"
import type { StorageApiAuth } from "@/lib/storage/auth"

function computerIdOrUnauthorized(auth: StorageApiAuth) {
  if (!auth.computerId) return apiError("Invalid computer token.", 401)
  return auth.computerId
}

function serializeComputer(
  computer: NonNullable<Awaited<ReturnType<typeof findRemoteComputerById>>>,
  extra?: { description?: string; createdAt?: string },
) {
  return {
    id: computer.id,
    name: computer.name,
    ...(extra?.description !== undefined
      ? { description: extra.description }
      : {}),
    status: computer.status,
    online: isRemoteComputerOnline(computer.lastHeartbeatAt, computer.revokedAt),
    currentProjectId: computer.currentProjectId,
    currentTask: computer.currentTask,
    lastHeartbeatAt: computer.lastHeartbeatAt?.toISOString() ?? null,
    meta: computer.meta,
    ...(extra?.createdAt !== undefined ? { createdAt: extra.createdAt } : {}),
  }
}

export const meAction = defineAction(z.object({}), async (auth) => {
  const computerId = computerIdOrUnauthorized(auth)
  if (typeof computerId !== "string") return computerId

  const computer = await findRemoteComputerById(computerId)
  if (!computer || computer.revokedAt) {
    return apiError("Computer not found.", 404)
  }

  return apiOk(
    serializeComputer(computer, {
      description: computer.description,
      createdAt: computer.createdAt.toISOString(),
    }),
  )
})

export const heartbeatAction = defineAction(
  z.object({
    status: z.enum(["idle", "busy", "error"]).optional(),
    currentProjectId: z.string().nullable().optional(),
    currentTask: z.string().max(500).nullable().optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
  async (auth, props) => {
    const computerId = computerIdOrUnauthorized(auth)
    if (typeof computerId !== "string") return computerId

    if (props.currentProjectId) {
      const project = await findProjectById(props.currentProjectId)
      if (!project) return apiError("Project not found.", 404)
    }

    const updated = await heartbeatRemoteComputer(computerId, {
      status: props.status,
      currentProjectId: props.currentProjectId,
      currentTask: props.currentTask,
      meta: props.meta,
    })

    if (!updated) return apiError("Computer not found.", 404)
    return apiOk(serializeComputer(updated))
  },
)
