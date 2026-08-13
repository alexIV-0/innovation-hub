import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireOwnedProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { StorageWriteError } from "@/lib/storage/errors"
import { restoreFromTrash } from "@/lib/storage/trash"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  fileId: z.string().min(1),
  eventId: z.string().optional(),
})

/** POST /api/storage/v1/trash/restore */
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

  const access = await requireOwnedProjectAccess(auth, parsed.data.projectId)
  if (access instanceof NextResponse) return access

  try {
    const file = await restoreFromTrash({
      userId: access.ownerId,
      projectId: access.projectId,
      fileId: parsed.data.fileId,
      eventId: parsed.data.eventId,
    })
    return NextResponse.json({ file })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    console.error("[storage] trash restore failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Restore failed." },
      { status: 500 },
    )
  }
}
