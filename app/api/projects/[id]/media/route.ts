import { randomUUID } from "node:crypto"
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { projectUploadObjectKey } from "@/lib/project-storage"
import {
  createFile,
  findFileById,
  listAllProjectFiles,
} from "@/lib/repositories/project-files"
import { findProjectForUser } from "@/lib/repositories/projects"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import {
  resolveUploadContentType,
  safeBaseFileName,
} from "@/lib/s3-upload-policy"

export const runtime = "nodejs"
export const maxDuration = 120

type RouteContext = { params: Promise<{ id: string }> }

const DEFAULT_MAX_BYTES = 250 * 1024 * 1024

function getMaxBytes() {
  const raw = process.env.PROJECT_MEDIA_UPLOAD_MAX_BYTES
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES
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

async function resolveUploadFolderPath(
  projectId: string,
  folderPathParam: string | null,
  parentId: string | null,
): Promise<string | null> {
  if (folderPathParam != null && folderPathParam !== "") {
    return folderPathParam.replace(/^\/+|\/+$/g, "")
  }
  if (!parentId || parentId === projectId) return ""

  const folder = await findFileById(parentId)
  if (!folder || folder.projectId !== projectId || !folder.isFolder) {
    return null
  }
  return folder.folderPath === ""
    ? folder.name
    : `${folder.folderPath}/${folder.name}`
}

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return jsonError("Project not found.", 404)
  }

  const files = (await listAllProjectFiles(project.id)).filter((f) => !f.isFolder)
  return NextResponse.json({
    media: files.map((f) => ({
      id: f.id,
      projectId: f.projectId,
      fileName: f.name,
      mimeType: f.contentType,
      sizeBytes: f.sizeBytes,
      driveFileId: null,
      s3Key: f.s3Key,
      createdAt: f.createdAt,
    })),
  })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  if (!isS3Configured()) {
    return jsonError(
      "Media uploads are temporarily unavailable. Please try again later.",
      503,
    )
  }

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return jsonError("Project not found.", 404)
  }

  const url = new URL(request.url)
  const folderPath = await resolveUploadFolderPath(
    project.id,
    url.searchParams.get("folderPath"),
    url.searchParams.get("parentId"),
  )
  if (folderPath == null) {
    return jsonError("Invalid upload folder.", 400)
  }

  const maxBytes = getMaxBytes()
  const fileNameRaw =
    url.searchParams.get("fileName") ??
    request.headers.get("x-file-name") ??
    "upload"
  const fileName = safeBaseFileName(decodeFileNameHeader(fileNameRaw))

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

  const chunks: Buffer[] = []
  let total = 0
  const reader = request.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        return jsonError(`File too large (max ${maxBytes} bytes).`, 413)
      }
      chunks.push(Buffer.from(value))
    }
  } catch {
    return jsonError("Upload stream interrupted.", 400)
  }

  const buffer = Buffer.concat(chunks)
  if (buffer.length === 0) {
    return jsonError("Empty file.", 400)
  }

  const objectName = `${randomUUID()}-${fileName}`
  const s3Key = projectUploadObjectKey(project.id, folderPath, objectName)

  try {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
      }),
    )
  } catch (error) {
    console.error("[project-media] R2 upload failed", error)
    return jsonError(
      error instanceof Error ? error.message : "Failed to upload file.",
      503,
    )
  }

  try {
    const file = await createFile({
      projectId: project.id,
      folderPath,
      name: fileName,
      s3Key,
      sizeBytes: buffer.length,
      contentType,
    })
    return NextResponse.json(
      {
        id: file.id,
        projectId: file.projectId,
        fileName: file.name,
        mimeType: file.contentType,
        sizeBytes: file.sizeBytes,
        driveFileId: null,
        s3Key: file.s3Key,
        createdAt: file.createdAt,
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("[project-media] DB insert failed after R2 upload", error)
    try {
      await getS3Client().send(
        new DeleteObjectCommand({ Bucket: getS3Bucket(), Key: s3Key }),
      )
    } catch (cleanupError) {
      console.error("[project-media] cleanup of orphaned R2 object failed", {
        s3Key,
        cleanupError,
      })
    }
    return jsonError("Failed to save the uploaded file.", 500)
  }
}
