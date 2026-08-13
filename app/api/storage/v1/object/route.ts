import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { OPTIONS_FOLDER_NAME } from "@/lib/project-storage"
import { findFileById } from "@/lib/repositories/project-files"
import { writeFileDelete } from "@/lib/storage/write-path"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
  eventId: z.string().optional(),
})

/** DELETE /api/storage/v1/object — body: { projectId, fileId } */
export async function DELETE(request: NextRequest) {
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
  const access = await requireEditableProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  const file = await findFileById(data.fileId)
  if (!file || file.projectId !== access.projectId) {
    return NextResponse.json({ message: "File not found." }, { status: 404 })
  }
  if (file.name.toLowerCase() === OPTIONS_FOLDER_NAME) {
    return NextResponse.json(
      { message: "This item is managed by automation." },
      { status: 403 },
    )
  }

  const result = await writeFileDelete({
    userId: access.ownerId,
    projectId: access.projectId,
    fileId: data.fileId,
    deletedBy: auth.userId,
    eventId: data.eventId,
  })
  return NextResponse.json({ ok: true, ...result })
}
