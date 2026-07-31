import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createFolderSchema,
  deleteFileSchema,
  renameFileSchema,
} from "@/lib/project-schemas"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"
import {
  createFolder,
  deleteFileCascade,
  listFilesInFolder,
  renameOrMoveFile,
} from "@/lib/repositories/project-files"
import { findOwnedProject } from "@/lib/repositories/projects"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  const folderPath = request.nextUrl.searchParams.get("folderPath") ?? ""
  const files = await listFilesInFolder(id, folderPath)
  return NextResponse.json({ files, folderPath })
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createFolderSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  try {
    const file = await createFolder({
      projectId: id,
      folderPath: parsed.data.folderPath,
      name: parsed.data.name,
    })
    return NextResponse.json({ file }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not create folder."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = renameFileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  try {
    const file = await renameOrMoveFile({
      id: parsed.data.id,
      projectId: id,
      name: parsed.data.name,
      folderPath: parsed.data.folderPath,
    })
    if (!file) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    return NextResponse.json({ file })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not rename."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = deleteFileSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const { deletedS3Keys } = await deleteFileCascade(parsed.data.id, id)

  if (deletedS3Keys.length > 0) {
    try {
      const client = getS3Client()
      const bucket = getS3Bucket()
      await Promise.allSettled(
        deletedS3Keys.map((key) =>
          client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
        ),
      )
    } catch {
      // ignore
    }
  }

  return NextResponse.json({ ok: true })
}
