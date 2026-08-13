import { NextResponse } from "next/server"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"
import { requireEditableProjectAccess } from "@/lib/storage/auth"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  abortMultipartSchema,
  abortMultipartUpload,
  completeMultipartSchema,
  completeMultipartUpload,
  createMultipartSchema,
  presignMultipartPart,
  presignPartSchema,
  startMultipartUpload,
} from "@/lib/storage/multipart"

function mapError(error: unknown) {
  if (error instanceof StorageWriteError) {
    return apiError(error.message, error.status)
  }
  return apiError(
    error instanceof Error ? error.message : "Multipart failed.",
    500,
  )
}

export const multipartCreateAction = defineAction(
  createMultipartSchema,
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access
    try {
      return apiOk(
        await startMultipartUpload({
          ownerId: access.ownerId,
          projectId: access.projectId,
          folderPath: data.folderPath,
          fileName: data.fileName,
          contentType: data.contentType,
        }),
      )
    } catch (error) {
      return mapError(error)
    }
  },
)

export const multipartPresignPartAction = defineAction(
  presignPartSchema,
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access
    try {
      return apiOk(
        await presignMultipartPart({
          ownerId: access.ownerId,
          projectId: access.projectId,
          s3Key: data.s3Key,
          uploadId: data.uploadId,
          partNumber: data.partNumber,
          ttlSec: data.ttlSec,
        }),
      )
    } catch (error) {
      return mapError(error)
    }
  },
)

export const multipartCompleteAction = defineAction(
  completeMultipartSchema,
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access
    try {
      const file = await completeMultipartUpload({
        ownerId: access.ownerId,
        projectId: access.projectId,
        s3Key: data.s3Key,
        uploadId: data.uploadId,
        folderPath: data.folderPath,
        fileName: data.fileName,
        contentType: data.contentType,
        parts: data.parts,
        sizeBytes: data.sizeBytes,
        contentHash: data.contentHash,
        originMtime: data.originMtime,
        eventId: data.eventId,
      })
      return apiOk({ file, fileIds: [file.id] })
    } catch (error) {
      return mapError(error)
    }
  },
)

export const multipartAbortAction = defineAction(
  abortMultipartSchema,
  async (auth, data) => {
    const access = await requireEditableProjectAccess(auth, data.projectId)
    if (access instanceof NextResponse) return access
    try {
      await abortMultipartUpload({
        ownerId: access.ownerId,
        projectId: access.projectId,
        s3Key: data.s3Key,
        uploadId: data.uploadId,
      })
      return apiOk({ ok: true })
    } catch (error) {
      return mapError(error)
    }
  },
)
