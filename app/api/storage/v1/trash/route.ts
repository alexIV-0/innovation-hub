import { NextResponse, type NextRequest } from "next/server"
import {
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { listTrash, purgeExpiredTrash } from "@/lib/storage/trash"

export const runtime = "nodejs"

/** GET /api/storage/v1/trash?projectId= */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  if (!projectId) {
    return NextResponse.json({ message: "projectId is required." }, { status: 400 })
  }

  const access = await requireEditableProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  await purgeExpiredTrash().catch((error) => {
    console.error("[storage] trash purge failed", error)
  })

  const items = await listTrash(access.projectId)
  return NextResponse.json({ items })
}
