import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createFolderSchema,
  deleteFileSchema,
  renameFileSchema,
} from "@/lib/project-schemas"
import {
  findFileById,
  listFilesInFolder,
} from "@/lib/repositories/project-files"
import { findOwnedProject } from "@/lib/repositories/projects"
import {
  writeFileDelete,
  writeFolderCreate,
  writeRename,
} from "@/lib/storage/write-path"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-storage"

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

  if (parsed.data.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This folder name is reserved." },
      { status: 403 },
    )
  }

  try {
    const file = await writeFolderCreate({
      userId: project.ownerId,
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
    const file = await writeRename({
      userId: project.ownerId,
      fileId: parsed.data.id,
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

  const existing = await findFileById(parsed.data.id)
  if (existing?.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This item is managed by automation." },
      { status: 403 },
    )
  }

  await writeFileDelete({
    userId: project.ownerId,
    projectId: id,
    fileId: parsed.data.id,
  })

  return NextResponse.json({ ok: true })
}
