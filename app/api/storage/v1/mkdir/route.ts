import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireOwnedProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-storage"
import { StorageWriteError, writeFolderCreate } from "@/lib/storage/write-path"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  folderPath: z.string().default(""),
  name: z.string().min(1).max(180),
  eventId: z.string().optional(),
})

/** POST /api/storage/v1/mkdir */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

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
  if (data.name.includes("/") || data.name.includes("\\")) {
    return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
  }
  if (data.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This folder name is reserved." },
      { status: 403 },
    )
  }

  const access = await requireOwnedProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    const file = await writeFolderCreate({
      userId: access.ownerId,
      projectId: access.projectId,
      folderPath: data.folderPath,
      name: data.name,
      eventId: data.eventId,
    })
    return NextResponse.json({ file }, { status: 201 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Could not create folder."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
