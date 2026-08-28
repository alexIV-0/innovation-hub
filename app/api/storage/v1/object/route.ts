import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { findFileById } from "@/lib/repositories/project-files"
import { StorageWriteError, writeFileDelete } from "@/lib/storage/write-path"

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
  try {
    const result = await writeFileDelete({
      storageOwnerId: access.storageOwnerId,
      projectId: access.projectId,
      fileId: data.fileId,
      deletedBy: auth.userId,
      eventId: data.eventId,
      actor: actorFromAuth(auth),
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    // 403 — попытка снести канонический сайдкар или саму папку options: сайт
    // читает их по фиксированному ключу. Остальное содержимое options удаляется
    // как любой файл, в корзину.
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    throw error
  }
}
