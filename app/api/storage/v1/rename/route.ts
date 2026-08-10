import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireOwnedProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { writeRename } from "@/lib/storage/write-path"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
  name: z.string().min(1).max(500).optional(),
  folderPath: z.string().optional(),
  eventId: z.string().optional(),
})

/** POST /api/storage/v1/rename — rename/move file or folder (no R2 key change). */
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
  if (data.name === undefined && data.folderPath === undefined) {
    return NextResponse.json(
      { message: "Provide name and/or folderPath." },
      { status: 400 },
    )
  }
  if (data.name?.includes("/") || data.name?.includes("\\")) {
    return NextResponse.json({ message: "Invalid name." }, { status: 400 })
  }

  const access = await requireOwnedProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    const file = await writeRename({
      userId: access.ownerId,
      projectId: access.projectId,
      fileId: data.fileId,
      name: data.name,
      folderPath: data.folderPath,
      eventId: data.eventId,
    })
    if (!file) {
      return NextResponse.json({ message: "File not found." }, { status: 404 })
    }
    return NextResponse.json({ file })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not rename."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
