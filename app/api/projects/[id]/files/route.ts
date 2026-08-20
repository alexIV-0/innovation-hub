import { DeleteObjectCommand } from "@aws-sdk/client-s3"
import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  createFolderSchema,
  deleteFileSchema,
  renameFileSchema,
} from "@/lib/project-schemas"
import { withoutServiceRows } from "@/lib/project-storage"
import { listFilesInFolder } from "@/lib/repositories/project-files"
import { findOwnedProject } from "@/lib/repositories/projects"
import {
  StorageWriteError,
  writeFileDelete,
  writeFolderCreate,
  writeRename,
} from "@/lib/storage/write-path"

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
  // Отсекаем и саму папку options в корне, и попытку зайти внутрь неё по
  // folderPath: это роут кабинета, служебные файлы показывает только «Конвейер».
  const files = withoutServiceRows(await listFilesInFolder(id, folderPath))
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
    const file = await writeFolderCreate({
      userId: project.ownerId,
      projectId: id,
      folderPath: parsed.data.folderPath,
      name: parsed.data.name,
      actor: { userId: auth.userId },
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
      actor: { userId: auth.userId },
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

  try {
    await writeFileDelete({
      userId: project.ownerId,
      projectId: id,
      fileId: parsed.data.id,
      deletedBy: auth.userId,
      actor: { userId: auth.userId },
    })
  } catch (error) {
    // Канонический сайдкар и саму папку options удалять нечем — сайт читает их
    // по фиксированному ключу. Остальное в options удаляется как обычный файл.
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    throw error
  }

  return NextResponse.json({ ok: true })
}
