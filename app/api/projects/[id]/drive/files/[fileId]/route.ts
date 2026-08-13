import { GetObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-storage"
import { findFileById } from "@/lib/repositories/project-files"
import { findProjectForUser } from "@/lib/repositories/projects"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client, isS3Configured } from "@/lib/s3-client"
import { writeFileDelete, writeRename, StorageWriteError } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ id: string; fileId: string }>
}

async function requireOwnedFile(projectId: string, userId: string, fileId: string) {
  const project = await findProjectForUser(projectId, userId)
  if (!project) return { error: NextResponse.json({ message: "Project not found." }, { status: 404 }) }
  const file = await findFileById(fileId)
  if (!file || file.projectId !== projectId) {
    return { error: NextResponse.json({ message: "File not found." }, { status: 404 }) }
  }
  if (file.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return {
      error: NextResponse.json(
        { message: "This item is managed by automation." },
        { status: 403 },
      ),
    }
  }
  return { project, file }
}

/** Download a project file from R2. */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const owned = await requireOwnedFile(id, auth.userId, fileId)
  if ("error" in owned && owned.error) return owned.error
  const { file } = owned as { file: NonNullable<Awaited<ReturnType<typeof findFileById>>> }

  if (file.isFolder || !file.s3Key) {
    return NextResponse.json(
      { message: "Folders cannot be downloaded." },
      { status: 400 },
    )
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available." },
      { status: 503 },
    )
  }

  try {
    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: getS3Bucket(), Key: file.s3Key }),
    )
    const body = response.Body
    if (!body) {
      return NextResponse.json({ message: "Empty object." }, { status: 404 })
    }
    const bytes = await body.transformToByteArray()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type":
          file.contentType || response.ContentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(file.name)}"`,
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error) {
    console.error("[project-storage] download failed", error)
    return NextResponse.json(
      { message: "Failed to download file." },
      { status: 503 },
    )
  }
}

/** Rename a file or folder. */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const owned = await requireOwnedFile(id, auth.userId, fileId)
  if ("error" in owned && owned.error) return owned.error

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : undefined
  const folderPath =
    typeof body?.folderPath === "string" ? body.folderPath : undefined
  if (name === undefined && folderPath === undefined) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }
  if (name !== undefined && (!name || name.includes("/") || name.includes("\\"))) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }
  if (name?.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This folder name is reserved." },
      { status: 403 },
    )
  }

  try {
    const file = await writeRename({
      userId: owned.project.ownerId,
      fileId,
      projectId: id,
      name,
      folderPath,
    })
    if (!file) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    return NextResponse.json({ file })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Rename failed."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

/** Delete a file or folder (and cascade). */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id, fileId } = await context.params
  const owned = await requireOwnedFile(id, auth.userId, fileId)
  if ("error" in owned && owned.error) return owned.error

  await writeFileDelete({
    userId: owned.project.ownerId,
    projectId: id,
    fileId,
    deletedBy: auth.userId,
  })

  return NextResponse.json({ ok: true })
}
