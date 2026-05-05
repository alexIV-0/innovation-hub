/**
 * Same-origin admin upload: browser sends multipart to Next, server writes to S3.
 * No bucket CORS is required for this flow (unlike presigned browser PUT to the storage host).
 */
import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  buildS3ObjectKey,
  getS3Bucket,
  publicObjectUrlForKey,
} from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"
import {
  getMaxUploadBytes,
  resolveUploadContentType,
  safeBaseFileName,
} from "@/lib/s3-upload-policy"

export const runtime = "nodejs"
/** Vercel Hobby allows 1–300s; other plans may allow more via dashboard. */
export const maxDuration = 300

function inferredPathStyleObjectUrl(bucket: string, key: string): string | null {
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim().replace(/\/+$/, "")
  if (!endpoint) return null
  const path = `${bucket}/${key}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${endpoint}/${path}`
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status })
}

async function runUpload(request: NextRequest): Promise<Response> {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const maxBytes = getMaxUploadBytes()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonError("Could not read upload body (size or format).", 400)
  }

  const raw = formData.get("file")
  if (!raw || !(raw instanceof Blob)) {
    return jsonError('Missing multipart field "file" or not a binary part.', 400)
  }

  const fileName = raw instanceof File ? raw.name : "upload"
  const size = raw.size

  if (size > maxBytes) {
    return jsonError(`File too large (max ${maxBytes} bytes).`, 413)
  }

  const contentType = resolveUploadContentType({
    name: fileName,
    type: raw.type,
  })
  if (!contentType) {
    return jsonError("Unsupported file type for upload.", 400)
  }

  let bucket: string
  let key: string
  try {
    bucket = getS3Bucket()
    key = buildS3ObjectKey(`${randomUUID()}-${safeBaseFileName(fileName)}`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Storage configuration error."
    return jsonError(msg, 500)
  }

  let client: ReturnType<typeof getS3Client>
  try {
    client = getS3Client()
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 client configuration error."
    return jsonError(msg, 500)
  }

  let body: Buffer
  try {
    body = Buffer.from(await raw.arrayBuffer())
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not read file bytes."
    return jsonError(msg, 400)
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )

    const publicUrl =
      publicObjectUrlForKey(key) ?? inferredPathStyleObjectUrl(bucket, key)

    if (!publicUrl) {
      return NextResponse.json(
        {
          message:
            "Upload succeeded but public URL is unknown: set NEXT_PUBLIC_S3_PUBLIC_BASE_URL or AWS_ENDPOINT_URL.",
          key,
        },
        { status: 502 },
      )
    }

    return NextResponse.json({
      key,
      contentType,
      publicUrl,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 upload failed."
    return jsonError(msg, 502)
  }
}

export async function POST(request: NextRequest) {
  try {
    return await runUpload(request)
  } catch (e) {
    console.error("[api/admin/upload]", e)
    const msg =
      e instanceof Error ? e.message : "Unexpected error in upload handler."
    return jsonError(msg, 500)
  }
}
