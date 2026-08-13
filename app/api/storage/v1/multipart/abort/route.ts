import { NextResponse, type NextRequest } from "next/server"
import {
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { StorageWriteError } from "@/lib/storage/errors"
import {
  abortMultipartSchema,
  abortMultipartUpload,
} from "@/lib/storage/multipart"

export const runtime = "nodejs"

/** POST /api/storage/v1/multipart/abort */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }
  const parsed = abortMultipartSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const access = await requireEditableProjectAccess(auth, parsed.data.projectId)
  if (access instanceof NextResponse) return access

  try {
    await abortMultipartUpload({
      ownerId: access.ownerId,
      projectId: access.projectId,
      s3Key: parsed.data.s3Key,
      uploadId: parsed.data.uploadId,
    })
    return NextResponse.json({ ok: true })
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
