import { randomUUID } from "node:crypto"
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse } from "next/server"
import { z } from "zod"
import { findFileById } from "@/lib/repositories/project-files"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"
import {
  requireEditableProjectAccess,
  requireOwnedProjectAccess,
  requireProjectAccess,
} from "@/lib/storage/auth"
import { projectPrefix } from "@/lib/storage/keys"
import {
  journalStorageEvent,
  reindexProject,
  StorageWriteError,
  writeFileDelete,
  writeFolderCreate,
  writeNotifyUpload,
  writeRename,
  writeSidecarPut,
} from "@/lib/storage/write-path"
import { setProjectPaused } from "@/lib/project-automation"
import {
  OPTIONS_FOLDER_NAME,
  ProjectStorageError,
  projectDescriptionKey,
  projectFolderStateKey,
  projectOptionsKey,
  projectUploadObjectKey,
  siteUpdatedBy,
  updateProjectExposedOptions,
} from "@/lib/project-storage"
import { isAllowedProjectContentType } from "@/lib/project-upload-policy"
import { safeBaseFileName } from "@/lib/s3-upload-policy"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"

export const presignAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    method: z.enum(["PUT", "GET"]),
    folderPath: z.string().optional().default(""),
    fileName: z.string().min(1).optional(),
    contentType: z.string().optional(),
    s3Key: z.string().optional(),
    ttlSec: z.number().int().min(60).max(86400).optional(),
  }),
  async (auth, data) => {
    if (!isS3Configured()) {
      return apiError("Object storage is not configured.", 503)
    }

    const access =
      data.method === "PUT"
        ? await requireEditableProjectAccess(auth, data.projectId)
        : await requireProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    const ttl = data.ttlSec ?? 3600
    const client = getS3Client()
    const bucket = getS3Bucket()
    const expectedPrefix = projectPrefix(access.ownerId, access.projectId)

    if (data.method === "GET") {
      if (!data.s3Key || !data.s3Key.startsWith(expectedPrefix)) {
        return apiError("Invalid key.", 400)
      }
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: data.s3Key }),
        { expiresIn: ttl },
      )
      return apiOk({ url, method: "GET", s3Key: data.s3Key, expiresIn: ttl })
    }

    const fileName = safeBaseFileName(data.fileName ?? "upload")
    const contentType = data.contentType ?? "application/octet-stream"
    if (!isAllowedProjectContentType(contentType)) {
      return apiError("Content type not allowed.", 400)
    }

    const s3Key =
      data.s3Key && data.s3Key.startsWith(expectedPrefix)
        ? data.s3Key
        : projectUploadObjectKey(
            access.ownerId,
            access.projectId,
            data.folderPath,
            `${randomUUID()}-${fileName}`,
          )

    const url = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        ContentType: contentType,
      }),
      { expiresIn: ttl },
    )

    return apiOk({
      url,
      method: "PUT",
      s3Key,
      fileName,
      folderPath: data.folderPath,
      contentType,
      expiresIn: ttl,
    })
  },
)

export const notifyAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    s3Key: z.string().min(1),
    folderPath: z.string().default(""),
    fileName: z.string().min(1),
    sizeBytes: z.number().nonnegative().optional(),
    contentType: z.string().optional(),
    originMtime: z.number().int().nonnegative().optional(),
    contentHash: z.string().min(1).max(128).optional(),
    eventId: z.string().optional(),
  }),
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    const expectedPrefix = projectPrefix(access.ownerId, access.projectId)
    if (!data.s3Key.startsWith(expectedPrefix)) {
      return apiError("Invalid key.", 400)
    }

    try {
      const file = await writeNotifyUpload({
        projectId: access.projectId,
        s3Key: data.s3Key,
        folderPath: data.folderPath,
        fileName: safeBaseFileName(data.fileName),
        sizeBytes: data.sizeBytes,
        contentType: data.contentType,
        originMtime: data.originMtime,
        contentHash: data.contentHash,
        eventId: data.eventId,
      })
      return apiOk({ file, fileIds: [file.id] }, 201)
    } catch (error) {
      if (error instanceof StorageWriteError) {
        return apiError(error.message, 409)
      }
      console.error("[machine-api] notify failed", error)
      return apiError(
        error instanceof Error ? error.message : "Notify failed.",
        503,
      )
    }
  },
)

export const mkdirAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    folderPath: z.string().default(""),
    name: z.string().min(1).max(180),
    eventId: z.string().optional(),
  }),
  async (auth, data) => {
    if (data.name.includes("/") || data.name.includes("\\")) {
      return apiError("Invalid folder name.", 400)
    }
    if (data.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
      return apiError("This folder name is reserved.", 403)
    }

    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    try {
      const file = await writeFolderCreate({
        userId: access.ownerId,
        projectId: access.projectId,
        folderPath: data.folderPath,
        name: data.name,
        eventId: data.eventId,
      })
      return apiOk({ file, fileIds: [file.id] }, 201)
    } catch (error) {
      if (error instanceof StorageWriteError) {
        return apiError(error.message, error.status)
      }
      const msg =
        error instanceof Error ? error.message : "Could not create folder."
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return apiError("A file or folder with that name already exists.", 409)
      }
      return apiError(msg, 500)
    }
  },
)

export const renameAction = defineAction(
  z
    .object({
      projectId: z.string().min(1),
      fileId: z.string().min(1),
      name: z.string().min(1).max(500).optional(),
      folderPath: z.string().optional(),
      eventId: z.string().optional(),
    })
    .refine((d) => d.name !== undefined || d.folderPath !== undefined, {
      message: "Provide name and/or folderPath.",
    }),
  async (auth, data) => {
    if (data.name?.includes("/") || data.name?.includes("\\")) {
      return apiError("Invalid name.", 400)
    }

    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    try {
      const file = await writeRename({
        userId: access.ownerId,
        projectId: access.projectId,
        fileId: data.fileId,
        name: data.name,
        folderPath: data.folderPath,
        eventId: data.eventId,
      })
      if (!file) return apiError("File not found.", 404)
      return apiOk({ file, fileIds: [file.id] })
    } catch (error) {
      if (error instanceof StorageWriteError) {
        return apiError(error.message, error.status)
      }
      const msg = error instanceof Error ? error.message : "Could not rename."
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return apiError("A file or folder with that name already exists.", 409)
      }
      return apiError(msg, 500)
    }
  },
)

export const deleteObjectAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    fileId: z.string().min(1),
    eventId: z.string().optional(),
  }),
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    const file = await findFileById(data.fileId)
    if (!file || file.projectId !== access.projectId) {
      return apiError("File not found.", 404)
    }
    if (file.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
      return apiError("This item is managed by automation.", 403)
    }

    const result = await writeFileDelete({
      userId: access.ownerId,
      projectId: access.projectId,
      fileId: data.fileId,
      deletedBy: auth.userId,
      eventId: data.eventId,
    })
    return apiOk({ ok: true, ...result })
  },
)

export const reindexAction = defineAction(
  z.object({
    projectId: z.string().min(1),
  }),
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access

    try {
      const stats = await reindexProject(access.ownerId, access.projectId)
      return apiOk({ ok: true, ...stats })
    } catch (error) {
      if (error instanceof StorageWriteError) {
        return apiError(error.message, 503)
      }
      console.error("[machine-api] reindex failed", error)
      return apiError(
        error instanceof Error ? error.message : "Reindex failed.",
        503,
      )
    }
  },
)

const putSidecarSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("folder-state"),
    projectId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("options"),
    projectId: z.string().min(1),
    changes: z.array(
      z.object({
        path: z.array(z.string()),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    ),
  }),
  z.object({
    kind: z.literal("raw"),
    projectId: z.string().min(1),
    // description — options/description.md, развёрнутое описание проекта.
    sidecar: z.enum(["folder-state", "options", "description"]),
    body: z.string().min(1),
    ifMatch: z.string().optional(),
  }),
])

export const putSidecarAction = defineAction(putSidecarSchema, async (auth, data) => {
  const access = await requireEditableProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    if (data.kind === "folder-state") {
      const { folderState } = await setProjectPaused({
        projectId: access.projectId,
        ownerId: access.ownerId,
        paused: !data.enabled,
        updatedBy: siteUpdatedBy(auth.email),
      })
      return apiOk({ folderState })
    }

    if (data.kind === "options") {
      const result = await updateProjectExposedOptions({
        userId: access.ownerId,
        projectId: access.projectId,
        changes: data.changes,
      })
      await journalStorageEvent({
        projectId: access.projectId,
        key: projectOptionsKey(access.ownerId, access.projectId),
        op: "put",
        payload: { name: "options.json", folderPath: "options" },
      })
      return apiOk({ options: result })
    }

    const key =
      data.sidecar === "folder-state"
        ? projectFolderStateKey(access.ownerId, access.projectId)
        : data.sidecar === "description"
          ? projectDescriptionKey(access.ownerId, access.projectId)
          : projectOptionsKey(access.ownerId, access.projectId)
    const { etag } = await writeSidecarPut({
      projectId: access.projectId,
      key,
      body: data.body,
      ifMatch: data.ifMatch,
    })
    return apiOk({ ok: true, etag })
  } catch (error) {
    if (
      error instanceof ProjectStorageError ||
      error instanceof StorageWriteError
    ) {
      return apiError(error.message, 409)
    }
    console.error("[machine-api] sidecar put failed", error)
    return apiError(
      error instanceof Error ? error.message : "Update failed.",
      503,
    )
  }
})

export const copyAction = defineAction(
  z.object({
    projectId: z.string().uuid(),
    fileIds: z.array(z.string().uuid()).min(1).max(500),
    destProjectId: z.string().uuid().optional(),
    destFolderPath: z.string().default(""),
    eventId: z.string().optional(),
  }),
  async (auth, data) => {
    const destProjectId = data.destProjectId ?? data.projectId
    const sourceAccess = await requireProjectAccess(auth, data.projectId)
    if (sourceAccess instanceof NextResponse) return sourceAccess
    const destAccess = await requireEditableProjectAccess(auth, destProjectId)
    if (destAccess instanceof NextResponse) return destAccess

    try {
      const { countCopyWork, copySingleFile, buildCopyPlan } = await import(
        "@/lib/storage/copy"
      )
      const { createJob } = await import("@/lib/storage/jobs")
      const { scheduleJob } = await import("@/lib/storage/job-runner")

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
        })
        return apiOk({ files: [file], fileIds: [file.id] })
      }

      await buildCopyPlan({
        projectId: data.projectId,
        fileIds: data.fileIds,
      })
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
        },
      })
      scheduleJob(job.id)
      return apiOk({ jobId: job.id }, 202)
    } catch (error) {
      if (error instanceof StorageWriteError) {
        return apiError(error.message, error.status)
      }
      return apiError(
        error instanceof Error ? error.message : "Copy failed.",
        500,
      )
    }
  },
)

export const getJobAction = defineAction(
  z.object({ jobId: z.string().uuid() }),
  async (auth, data) => {
    const { getJob, serializeJob } = await import("@/lib/storage/jobs")
    const job = await getJob(data.jobId)
    if (!job) return apiError("Job not found.", 404)
    if (auth.role !== "ADMIN" && job.userId !== auth.userId) {
      return apiError("Job not found.", 404)
    }
    return apiOk({ job: serializeJob(job) })
  },
)
