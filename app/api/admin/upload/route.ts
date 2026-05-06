/**
 * Same-origin admin upload: browser sends the raw file as the request body
 * (NOT multipart). The server pipes that ReadableStream straight into S3
 * via @aws-sdk/lib-storage `Upload` (multipart, streamed, auto-retry).
 *
 * This avoids buffering large videos in server memory and lets the client
 * report real upload progress via XMLHttpRequest.upload.onprogress.
 *
 * No bucket CORS is required for this flow (unlike presigned browser PUT
 * to the storage host).
 */
import { randomUUID } from "node:crypto"
import { Upload } from "@aws-sdk/lib-storage"
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

function appMediaUrl(request: NextRequest, key: string): string {
  const encodedKeyPath = key.split("/").map((segment) => encodeURIComponent(segment)).join("/")
  return new URL(`/api/media/${encodedKeyPath}`, request.url).toString()
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ message }, { status })
}

function decodeFileNameHeader(value: string | null): string {
  if (!value) return "upload"
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

async function runUpload(request: NextRequest): Promise<Response> {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const maxBytes = getMaxUploadBytes()

  const url = new URL(request.url)
  const fileNameRaw =
    url.searchParams.get("fileName") ??
    request.headers.get("x-file-name") ??
    "upload"
  const fileName = decodeFileNameHeader(fileNameRaw)

  const headerType = request.headers.get("content-type") ?? ""
  const contentType = resolveUploadContentType({
    name: fileName,
    type: headerType,
  })
  if (!contentType) {
    return jsonError("Unsupported file type for upload.", 400)
  }

  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  )
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return jsonError(`File too large (max ${maxBytes} bytes).`, 413)
  }

  if (!request.body) {
    return jsonError("Empty request body.", 400)
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

  try {
    /**
     * Stream the request body straight to S3 in 8 MB parts, up to 4 parts
     * in flight. lib-storage handles multipart create/complete and retries
     * failed parts automatically, which is much more reliable than a single
     * PutObjectCommand for large videos.
     */
    const upload = new Upload({
      client,
      params: {
        Bucket: bucket,
        Key: key,
        Body: request.body,
        ContentType: contentType,
      },
      partSize: 8 * 1024 * 1024,
      queueSize: 4,
      leavePartsOnError: false,
    })

    await upload.done()

    const publicUrl = publicObjectUrlForKey(key) ?? appMediaUrl(request, key)

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
