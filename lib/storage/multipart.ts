import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { isAllowedProjectContentType } from "@/lib/project-upload-policy"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { safeBaseFileName } from "@/lib/s3-upload-policy"
import { projectPrefix } from "@/lib/storage/keys"
import {
  StorageWriteError,
  writeNotifyUpload,
  type StorageActor,
} from "@/lib/storage/write-path"

export const createMultipartSchema = z.object({
  projectId: z.string().uuid(),
  folderPath: z.string().default(""),
  fileName: z.string().min(1),
  contentType: z.string().optional(),
})

export const presignPartSchema = z.object({
  projectId: z.string().uuid(),
  s3Key: z.string().min(1),
  uploadId: z.string().min(1),
  partNumber: z.number().int().min(1).max(10000),
  ttlSec: z.number().int().min(60).max(86400).optional(),
})

export const completeMultipartSchema = z.object({
  projectId: z.string().uuid(),
  s3Key: z.string().min(1),
  uploadId: z.string().min(1),
  folderPath: z.string().default(""),
  fileName: z.string().min(1),
  contentType: z.string().optional(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1),
        etag: z.string().min(1),
      }),
    )
    .min(1),
  sizeBytes: z.number().nonnegative().optional(),
  contentHash: z.string().optional(),
  originMtime: z.number().int().optional(),
  eventId: z.string().optional(),
})

export const abortMultipartSchema = z.object({
  projectId: z.string().uuid(),
  s3Key: z.string().min(1),
  uploadId: z.string().min(1),
})

export function assertStorageConfigured() {
  if (!isS3Configured()) {
    throw new StorageWriteError("Object storage is not configured.", 503)
  }
}

export async function startMultipartUpload(input: {
  ownerId: string
  projectId: string
  folderPath: string
  fileName: string
  contentType?: string
}) {
  assertStorageConfigured()
  const fileName = safeBaseFileName(input.fileName)
  const contentType = input.contentType ?? "application/octet-stream"
  if (!isAllowedProjectContentType(contentType)) {
    throw new StorageWriteError("Content type not allowed.", 400)
  }
  const s3Key = projectUploadObjectKey(
    input.ownerId,
    input.projectId,
    input.folderPath,
    `${randomUUID()}-${fileName}`,
  )
  const response = await getS3Client().send(
    new CreateMultipartUploadCommand({
      Bucket: getS3Bucket(),
      Key: s3Key,
      ContentType: contentType,
    }),
  )
  if (!response.UploadId) {
    throw new StorageWriteError("Could not start multipart upload.", 500)
  }
  return {
    uploadId: response.UploadId,
    s3Key,
    fileName,
    folderPath: input.folderPath,
    contentType,
  }
}

export async function presignMultipartPart(input: {
  ownerId: string
  projectId: string
  s3Key: string
  uploadId: string
  partNumber: number
  ttlSec?: number
}) {
  assertStorageConfigured()
  const expectedPrefix = projectPrefix(input.ownerId, input.projectId)
  if (!input.s3Key.startsWith(expectedPrefix)) {
    throw new StorageWriteError("Invalid key.", 400)
  }
  const ttl = input.ttlSec ?? 3600
  const url = await getSignedUrl(
    getS3Client(),
    new UploadPartCommand({
      Bucket: getS3Bucket(),
      Key: input.s3Key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber,
    }),
    { expiresIn: ttl },
  )
  return {
    url,
    method: "PUT" as const,
    partNumber: input.partNumber,
    expiresIn: ttl,
  }
}

export async function completeMultipartUpload(input: {
  ownerId: string
  projectId: string
  s3Key: string
  uploadId: string
  folderPath: string
  fileName: string
  contentType?: string
  parts: { partNumber: number; etag: string }[]
  sizeBytes?: number
  contentHash?: string
  originMtime?: number
  eventId?: string
  actor?: StorageActor | null
}) {
  assertStorageConfigured()
  const expectedPrefix = projectPrefix(input.ownerId, input.projectId)
  if (!input.s3Key.startsWith(expectedPrefix)) {
    throw new StorageWriteError("Invalid key.", 400)
  }
  await getS3Client().send(
    new CompleteMultipartUploadCommand({
      Bucket: getS3Bucket(),
      Key: input.s3Key,
      UploadId: input.uploadId,
      MultipartUpload: {
        Parts: input.parts
          .slice()
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
      },
    }),
  )
  const file = await writeNotifyUpload({
    userId: input.ownerId,
    projectId: input.projectId,
    s3Key: input.s3Key,
    folderPath: input.folderPath,
    fileName: input.fileName,
    sizeBytes: input.sizeBytes,
    contentType: input.contentType,
    contentHash: input.contentHash,
    originMtime: input.originMtime,
    eventId: input.eventId,
    actor: input.actor,
  })
  return file
}

export async function abortMultipartUpload(input: {
  ownerId: string
  projectId: string
  s3Key: string
  uploadId: string
}) {
  assertStorageConfigured()
  const expectedPrefix = projectPrefix(input.ownerId, input.projectId)
  if (!input.s3Key.startsWith(expectedPrefix)) {
    throw new StorageWriteError("Invalid key.", 400)
  }
  await getS3Client().send(
    new AbortMultipartUploadCommand({
      Bucket: getS3Bucket(),
      Key: input.s3Key,
      UploadId: input.uploadId,
    }),
  )
}
