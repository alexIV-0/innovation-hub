import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { projectPrefix } from "@/lib/storage/keys"
import {
  StorageWriteError,
  writeNotifyUpload,
} from "@/lib/storage/write-path"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  s3Key: z.string().min(1),
  folderPath: z.string().default(""),
  fileName: z.string().min(1),
  sizeBytes: z.number().nonnegative().optional(),
  contentType: z.string().optional(),
  /** Unix seconds — when the file was last modified on the source machine. */
  originMtime: z.number().int().nonnegative().optional(),
  /** e.g. sha256 hex; preferred over multipart-unreliable etag for freshness. */
  contentHash: z.string().min(1).max(128).optional(),
  eventId: z.string().optional(),
})

/** POST /api/storage/v1/notify — confirm object after direct R2 upload. */
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
  const access = await requireEditableProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  const expectedPrefix = projectPrefix(access.ownerId, access.projectId)
  if (!data.s3Key.startsWith(expectedPrefix)) {
    return NextResponse.json({ message: "Invalid key." }, { status: 400 })
  }

  try {
    const file = await writeNotifyUpload({
      projectId: access.projectId,
      s3Key: data.s3Key,
      folderPath: data.folderPath,
      fileName: data.fileName,
      sizeBytes: data.sizeBytes,
      contentType: data.contentType,
      originMtime: data.originMtime,
      contentHash: data.contentHash,
      eventId: data.eventId,
      // Основной путь загрузки из кабинета (lib/project-direct-upload.ts): здесь
      // и фиксируется, кто принёс файл, — дальше это имя уедет в contact задачи.
      actor: actorFromAuth(auth),
    })
    return NextResponse.json({ file, fileIds: [file.id] }, { status: 201 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    console.error("[storage] notify failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Notify failed." },
      { status: 503 },
    )
  }
}
