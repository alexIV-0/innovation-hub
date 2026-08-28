import { NextResponse, type NextRequest } from "next/server"
import {
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import {
  createMultipartSchema,
  startMultipartUpload,
} from "@/lib/storage/multipart"
import { StorageWriteError } from "@/lib/storage/errors"

export const runtime = "nodejs"

/** POST /api/storage/v1/multipart/create */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = createMultipartSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const access = await requireEditableProjectAccess(auth, parsed.data.projectId)
  if (access instanceof NextResponse) return access

  try {
    const result = await startMultipartUpload({
      storageOwnerId: access.storageOwnerId,
      projectId: access.projectId,
      folderPath: parsed.data.folderPath,
      fileName: parsed.data.fileName,
      contentType: parsed.data.contentType,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      )
    }
    throw error
  }
}
