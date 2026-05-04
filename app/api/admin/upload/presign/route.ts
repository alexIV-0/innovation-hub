/**
 * Presigned PUT URL for uploading directly to S3 from a client.
 *
 * Browser uploads from your app origin to the storage endpoint require **CORS**
 * on the bucket (methods PUT/OPTIONS, header Content-Type, allowed origins).
 * For uploads from the admin UI, prefer same-origin `POST /api/admin/upload`
 * instead, which avoids CORS entirely.
 */
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { getS3Client } from "@/lib/s3-client"
import {
  buildS3ObjectKey,
  getS3Bucket,
  publicObjectUrlForKey,
} from "@/lib/s3-config"
import {
  isAllowedUploadContentType,
  safeBaseFileName,
} from "@/lib/s3-upload-policy"

function inferredPathStyleObjectUrl(bucket: string, key: string): string | null {
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim().replace(/\/+$/, "")
  if (!endpoint) return null
  const path = `${bucket}/${key}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${endpoint}/${path}`
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const fileName =
    typeof body === "object" &&
    body !== null &&
    "fileName" in body &&
    typeof (body as { fileName?: unknown }).fileName === "string"
      ? (body as { fileName: string }).fileName.trim()
      : ""

  const contentType =
    typeof body === "object" &&
    body !== null &&
    "contentType" in body &&
    typeof (body as { contentType?: unknown }).contentType === "string"
      ? (body as { contentType: string }).contentType.trim().toLowerCase()
      : ""

  if (!fileName || !contentType || !isAllowedUploadContentType(contentType)) {
    return NextResponse.json(
      { message: "Invalid fileName or unsupported Content-Type." },
      { status: 400 },
    )
  }

  const bucket = getS3Bucket()
  const key = buildS3ObjectKey(`${randomUUID()}-${safeBaseFileName(fileName)}`)

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  })

  const client = getS3Client()

  try {
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 })

    const publicUrl =
      publicObjectUrlForKey(key) ?? inferredPathStyleObjectUrl(bucket, key)

    return NextResponse.json({
      uploadUrl,
      key,
      method: "PUT" as const,
      contentType,
      publicUrl,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not prepare upload URL."
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}
