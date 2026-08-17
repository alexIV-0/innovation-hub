import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { buildCopyPlan, copySingleFile, countCopyWork } from "@/lib/storage/copy"
import { createJob } from "@/lib/storage/jobs"
import { scheduleJob } from "@/lib/storage/job-runner"
import { StorageWriteError } from "@/lib/storage/errors"
import { writeEnsureFolderPath } from "@/lib/storage/write-path"
import { findProjectById } from "@/lib/repositories/projects"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().uuid(),
  fileIds: z.array(z.string().uuid()).min(1).max(500),
  destProjectId: z.string().uuid().optional(),
  destFolderPath: z.string().default(""),
  eventId: z.string().optional(),
})

/**
 * POST /api/storage/v1/copy
 * Single file → 200 { files }; folder/batch → 202 { jobId }.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const data = parsed.data
  const destProjectId = data.destProjectId ?? data.projectId

  const sourceAccess = await requireProjectAccess(auth, data.projectId)
  if (sourceAccess instanceof NextResponse) return sourceAccess

  // Destination requires write (owned / editor). Machine tokens stay on owned.
  const destAccess = await requireEditableProjectAccess(auth, destProjectId)
  if (destAccess instanceof NextResponse) return destAccess

  try {
    const { total, syncSingle } = await countCopyWork(
      data.projectId,
      data.fileIds,
    )

    if (syncSingle) {
      const file = await copySingleFile({
        sourceProjectId: data.projectId,
        destProjectId: destAccess.projectId,
        destOwnerId: destAccess.ownerId,
        destFolderPath: data.destFolderPath,
        source: syncSingle,
        eventId: data.eventId ?? null,
        actor: actorFromAuth(auth),
      })
      return NextResponse.json({ files: [file], fileIds: [file.id] })
    }

    // Validate plan exists before enqueueing.
    await buildCopyPlan({ projectId: data.projectId, fileIds: data.fileIds })

    // Папка назначения — строкой, один раз на задание, а не на каждый элемент:
    // без неё скопированное поддерево не покажется в дереве проекта.
    if (data.destFolderPath.replace(/^\/+|\/+$/g, "")) {
      await writeEnsureFolderPath({
        userId: destAccess.ownerId,
        projectId: destAccess.projectId,
        folderPath: data.destFolderPath,
        actor: actorFromAuth(auth),
      })
    }

    const destProject = await findProjectById(destAccess.projectId)
    if (!destProject) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }

    const job = await createJob({
      userId: auth.userId,
      projectId: destAccess.projectId,
      kind: "copy",
      total,
      eventId: data.eventId ?? null,
      payload: {
        sourceProjectId: data.projectId,
        destProjectId: destAccess.projectId,
        destOwnerId: destAccess.ownerId,
        destFolderPath: data.destFolderPath,
        fileIds: data.fileIds,
        eventId: data.eventId,
        // Асинхронную часть копирования исполняет job-runner уже без запроса,
        // поэтому актора кладём в payload — иначе файлы приедут без заливщика.
        actorUserId: auth.userId,
        actorIsUploader: auth.computerId == null,
      },
    })
    scheduleJob(job.id)
    return NextResponse.json({ jobId: job.id }, { status: 202 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    console.error("[storage/copy]", error)
    return NextResponse.json(
      { message: "Copy failed." },
      { status: 500 },
    )
  }
}
