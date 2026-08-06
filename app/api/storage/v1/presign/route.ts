import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireOwnedProjectAccess,
  requireProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { projectPrefix } from "@/lib/storage/keys"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { isAllowedProjectContentType } from "@/lib/project-upload-policy"
import { safeBaseFileName } from "@/lib/s3-upload-policy"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { randomUUID } from "node:crypto"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  method: z.enum(["PUT", "GET"]),
  folderPath: z.string().optional().default(""),
  fileName: z.string().min(1).optional(),
  contentType: z.string().optional(),
  s3Key: z.string().optional(),
  ttlSec: z.number().int().min(60).max(86400).optional(),
})

/** POST /api/storage/v1/presign — signed PUT/GET; bytes go direct to R2. */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not configured." },
      { status: 503 },
    )
  }

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
  const access =
    data.method === "PUT"
      ? await requireOwnedProjectAccess(auth, data.projectId)
      : await requireProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  const ttl = data.ttlSec ?? 3600
  const client = getS3Client()
  const bucket = getS3Bucket()
  const expectedPrefix = projectPrefix(access.projectId)

  if (data.method === "GET") {
    if (!data.s3Key || !data.s3Key.startsWith(expectedPrefix)) {
      return NextResponse.json({ message: "Invalid key." }, { status: 400 })
    }
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({ Bucket: bucket, Key: data.s3Key }),
      { expiresIn: ttl },
    )
    return NextResponse.json({ url, method: "GET", s3Key: data.s3Key, expiresIn: ttl })
  }

  const fileName = safeBaseFileName(data.fileName ?? "upload")
  const contentType = data.contentType ?? "application/octet-stream"
  if (!isAllowedProjectContentType(contentType)) {
    return NextResponse.json({ message: "Content type not allowed." }, { status: 400 })
  }

  const s3Key =
    data.s3Key && data.s3Key.startsWith(expectedPrefix)
      ? data.s3Key
      : projectUploadObjectKey(
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

  return NextResponse.json({
    url,
    method: "PUT",
    s3Key,
    fileName,
    folderPath: data.folderPath,
    contentType,
    expiresIn: ttl,
  })
}
