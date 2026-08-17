import { findProjectById } from "@/lib/repositories/projects"
import { buildCopyPlan, copyPlanItem } from "@/lib/storage/copy"
import {
  claimJob,
  finishJob,
  getJob,
  listQueuedJobs,
  requeueStaleRunningJobs,
  setJobProgress,
  type StorageJobRecord,
} from "@/lib/storage/jobs"
import { rebuildCatalogSnapshot } from "@/lib/storage/catalog"
import { purgeDeletedProjects } from "@/lib/storage/project-trash"
import { purgeExpiredTrash } from "@/lib/storage/trash"

async function runCopyJob(job: StorageJobRecord): Promise<void> {
  const payload = job.payload as {
    sourceProjectId?: string
    destProjectId?: string
    destOwnerId?: string
    destFolderPath?: string
    fileIds?: string[]
    eventId?: string
    /** Кто запустил копирование — актора не восстановить из джоба иначе. */
    actorUserId?: string
    actorIsUploader?: boolean
  }

  const sourceProjectId = payload.sourceProjectId ?? job.projectId
  const destProjectId = payload.destProjectId ?? job.projectId
  const destOwnerId = payload.destOwnerId
  const destFolderPath = payload.destFolderPath ?? ""
  const fileIds = payload.fileIds ?? []

  if (!sourceProjectId || !destProjectId || !destOwnerId || fileIds.length === 0) {
    await finishJob(job.id, {
      state: "failed",
      error: "Invalid copy job payload.",
    })
    return
  }

  const { items } = await buildCopyPlan({
    projectId: sourceProjectId,
    fileIds,
  })
  await setJobProgress(job.id, 0, items.length, { fileIds: [] })

  const folderPathMap = new Map<string, string>()
  const createdIds: string[] = []
  let done = 0

  for (const item of items) {
    const file = await copyPlanItem({
      destProjectId,
      destOwnerId,
      destFolderPath,
      item,
      folderPathMap,
      eventId: payload.eventId
        ? `${payload.eventId}:${item.source.id}`
        : null,
      actor: {
        userId: payload.actorUserId ?? job.userId,
        isUploader: payload.actorIsUploader !== false,
      },
    })
    createdIds.push(file.id)
    done++
    await setJobProgress(job.id, done, items.length, { fileIds: createdIds })
  }

  await finishJob(job.id, {
    state: "done",
    done: createdIds.length,
    payload: { fileIds: createdIds },
  })
}

async function runRecatalogJob(job: StorageJobRecord): Promise<void> {
  if (!job.projectId) {
    await finishJob(job.id, { state: "failed", error: "Missing projectId." })
    return
  }
  const project = await findProjectById(job.projectId)
  if (!project) {
    await finishJob(job.id, { state: "failed", error: "Project not found." })
    return
  }
  const cursor = await rebuildCatalogSnapshot(project.userId, project.id)
  await finishJob(job.id, {
    state: "done",
    done: 1,
    payload: { cursor },
  })
}

async function runPurgeJob(job: StorageJobRecord): Promise<void> {
  const fileResult = await purgeExpiredTrash()
  const projectResult = await purgeDeletedProjects()
  await finishJob(job.id, {
    state: "done",
    done: fileResult.purged + projectResult.purged,
    payload: {
      filesPurged: fileResult.purged,
      projectsPurged: projectResult.purged,
    },
  })
}

export async function executeJob(jobId: string): Promise<StorageJobRecord | null> {
  const claimed = await claimJob(jobId)
  if (!claimed) return getJob(jobId)

  try {
    switch (claimed.kind) {
      case "copy":
        await runCopyJob(claimed)
        break
      case "recatalog":
        await runRecatalogJob(claimed)
        break
      case "purge":
        await runPurgeJob(claimed)
        break
      case "move":
        await finishJob(claimed.id, {
          state: "failed",
          error: "Cross-project move jobs are not implemented yet.",
        })
        break
      default:
        await finishJob(claimed.id, {
          state: "failed",
          error: `Unknown job kind: ${claimed.kind}`,
        })
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Job failed."
    console.error(`[storage-jobs] ${claimed.id} failed`, error)
    await finishJob(claimed.id, { state: "failed", error: message })
  }

  return getJob(jobId)
}

/** Fire-and-forget runner for HTTP 202 responses. */
export function scheduleJob(jobId: string): void {
  void executeJob(jobId).catch((error) => {
    console.error(`[storage-jobs] schedule ${jobId}`, error)
  })
}

export async function processQueuedJobs(limit = 10): Promise<{
  requeued: number
  processed: number
}> {
  const requeued = await requeueStaleRunningJobs()
  const queued = await listQueuedJobs(limit)
  let processed = 0
  for (const job of queued) {
    await executeJob(job.id)
    processed++
  }
  return { requeued, processed }
}
