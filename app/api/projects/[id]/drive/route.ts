import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  loadProjectStorageState,
  OPTIONS_FOLDER_NAME,
} from "@/lib/project-storage"
import { findProjectForUser } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import { writeFolderCreate } from "@/lib/storage/write-path"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Live listing of the project's file tree from Postgres + automation JSON
 * from R2. The service `options` folder is hidden.
 * @deprecated Prefer GET /api/storage/v1/tree — kept for cabinet UI compatibility.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }

  try {
    const state = await loadProjectStorageState(project.ownerId, project.id)
    return NextResponse.json({
      ...state,
      storageAvailable: state.available,
    })
  } catch (error) {
    console.error("[project-storage] listing failed", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Failed to load project files.",
      },
      { status: 503 },
    )
  }
}

/** Create a subfolder inside the project file tree. */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const project = await findProjectForUser(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!isS3Configured()) {
    return NextResponse.json(
      { message: "Object storage is not available for this project." },
      { status: 409 },
    )
  }

  const body = await request.json().catch(() => null)
  const name =
    typeof body?.name === "string" ? body.name.trim().slice(0, 180) : ""
  const parentFolderPath =
    typeof body?.folderPath === "string"
      ? body.folderPath
      : typeof body?.parentFolderPath === "string"
        ? body.parentFolderPath
        : ""

  if (!name || name.includes("/") || name.includes("\\")) {
    return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
  }
  if (name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This folder name is reserved." },
      { status: 403 },
    )
  }

  try {
    const folder = await writeFolderCreate({
      userId: project.ownerId,
      projectId: project.id,
      folderPath: parentFolderPath,
      name,
    })
    return NextResponse.json(
      { id: folder.id, name: folder.name, folderPath: folder.folderPath },
      { status: 201 },
    )
  } catch (error) {
    console.error("[project-storage] create folder failed", error)
    const msg = error instanceof Error ? error.message : "Failed to create folder."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 503 })
  }
}
