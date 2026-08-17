import { randomUUID } from "node:crypto"
import { PutObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { confirmUploadSchema, presignUploadSchema } from "@/lib/project-schemas"
import { isAllowedProjectContentType } from "@/lib/project-upload-policy"
import { findOwnedProject } from "@/lib/repositories/projects"
import { safeBaseFileName } from "@/lib/s3-upload-policy"
import {
  appMediaProxyPathForKey,
  getS3Bucket,
} from "@/lib/s3-config"
import { projectPrefix } from "@/lib/storage/keys"
import { projectUploadObjectKey } from "@/lib/project-storage"
import { getS3Client } from "@/lib/s3-client"
import { writeNotifyUpload } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id: projectId } = await params
  const project = await findOwnedProject(projectId, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  // Confirm upload (after browser PUT) creates the DB row.
  if (
    typeof body === "object" &&
    body !== null &&
    "s3Key" in body &&
    typeof (body as { s3Key?: unknown }).s3Key === "string"
  ) {
    const parsed = confirmUploadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues[0]?.message ?? "Invalid input." },
        { status: 400 },
      )
    }

    const expectedPrefix = projectPrefix(project.ownerId, projectId)
    if (!parsed.data.s3Key.startsWith(expectedPrefix)) {
      return NextResponse.json({ message: "Invalid key." }, { status: 400 })
    }

    try {
      const file = await writeNotifyUpload({
        projectId,
        folderPath: parsed.data.folderPath,
        fileName: safeBaseFileName(parsed.data.fileName),
        s3Key: parsed.data.s3Key,
        sizeBytes: parsed.data.sizeBytes,
        contentType: parsed.data.contentType,
        actor: { userId: auth.userId },
      })
      return NextResponse.json(
        {
          file,
          mediaUrl: appMediaProxyPathForKey(parsed.data.s3Key),
        },
        { status: 201 },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save file."
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return NextResponse.json(
          { message: "A file with that name already exists." },
          { status: 409 },
        )
      }
      return NextResponse.json({ message: msg }, { status: 500 })
    }
  }

  // Presign request
  const parsed = presignUploadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const contentType = parsed.data.contentType.trim().toLowerCase()
  if (!isAllowedProjectContentType(contentType)) {
    return NextResponse.json(
      { message: "Unsupported Content-Type." },
      { status: 400 },
    )
  }

  const key = projectUploadObjectKey(
    project.ownerId,
    projectId,
    parsed.data.folderPath,
    `${randomUUID()}-${safeBaseFileName(parsed.data.fileName)}`,
  )

  const command = new PutObjectCommand({
    Bucket: getS3Bucket(),
    Key: key,
  })

  try {
    const uploadUrl = await getSignedUrl(getS3Client(), command, {
      expiresIn: 900,
    })
    return NextResponse.json({
      uploadUrl,
      key,
      method: "PUT" as const,
      contentType,
      folderPath: parsed.data.folderPath,
      mediaUrl: appMediaProxyPathForKey(key),
    })
  } catch (e) {
    const msg =
      e instanceof Error ? e.message : "Could not prepare upload URL."
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}
