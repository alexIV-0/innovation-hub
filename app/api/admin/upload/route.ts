/**
 * Same-origin admin upload: browser sends multipart to Next, server writes to S3.
 * No bucket CORS is required for this flow (unlike presigned browser PUT to the storage host).
 */
import { randomUUID } from "node:crypto"
import { Readable } from "node:stream"
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

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const maxBytes = getMaxUploadBytes()

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json(
      { message: "Could not read upload body (size or format)." },
      { status: 400 },
    )
  }

  const file = formData.get("file")
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ message: "Missing multipart field \"file\"." }, { status: 400 })
  }

  if (file.size > maxBytes) {
    return NextResponse.json(
      { message: `File too large (max ${maxBytes} bytes).` },
      { status: 413 },
    )
  }

  const contentType = resolveUploadContentType({ name: file.name, type: file.type })
  if (!contentType) {
    return NextResponse.json(
      { message: "Unsupported file type for upload." },
      { status: 400 },
    )
  }

  const bucket = getS3Bucket()
  const key = buildS3ObjectKey(`${randomUUID()}-${safeBaseFileName(file.name)}`)

  const client = getS3Client()

  const webStream = file.stream()
  const body = Readable.fromWeb(
    webStream as import("stream/web").ReadableStream<Uint8Array>,
  )

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: file.size,
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
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}
