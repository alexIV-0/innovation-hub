import { Readable } from "node:stream"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  deleteDriveFile,
  GoogleDriveError,
  isGoogleDriveConfigured,
  uploadDriveFile,
} from "@/lib/google-drive"
import {
  createProjectMedia,
  findProjectForUser,
  listProjectMedia,
} from "@/lib/repositories/projects"
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

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return jsonError("Project not found.", 404)
  }

  const media = await listProjectMedia(project.id)
  return NextResponse.json({ media })
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  if (!isGoogleDriveConfigured()) {
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
  if (!project.driveFolderId) {
    return jsonError(
      "This project is not ready for uploads yet. Please recreate it or contact support.",
      409,
    )
  }

  const maxBytes = getMaxBytes()
  const url = new URL(request.url)
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

  // Buffer into memory with a hard cap — Drive multipart needs a known stream.
  // For very large assets, raise PROJECT_MEDIA_UPLOAD_MAX_BYTES carefully.
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

  let driveFileId: string
  try {
    driveFileId = await uploadDriveFile({
      name: fileName,
      parentId: project.driveFolderId,
      mimeType: contentType,
      body: Readable.from(buffer),
    })
  } catch (error) {
    console.error("[project-media] Drive upload failed", error)
    const message =
      error instanceof GoogleDriveError
        ? error.message
        : "Failed to upload file."
    return jsonError(message, 503)
  }

  let media
  try {
    media = await createProjectMedia({
      projectId: project.id,
      fileName,
      mimeType: contentType,
      sizeBytes: buffer.length,
      driveFileId,
    })
  } catch (error) {
    console.error("[project-media] DB insert failed after Drive upload", error)
    // Compensate: remove the just-uploaded file so Drive doesn't accumulate
    // orphans the app has no record of.
    try {
      await deleteDriveFile(driveFileId)
    } catch (cleanupError) {
      console.error(
        "[project-media] cleanup of orphaned Drive file failed",
        { driveFileId, cleanupError },
      )
    }
    return jsonError("Failed to save the uploaded file.", 500)
  }

  return NextResponse.json(
    {
      ...media,
      sizeBytes:
        media.sizeBytes == null
          ? buffer.length
          : typeof media.sizeBytes === "number"
            ? media.sizeBytes
            : Number(media.sizeBytes),
    },
    { status: 201 },
  )
}
