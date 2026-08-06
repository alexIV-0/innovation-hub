import { NextResponse, type NextRequest } from "next/server"
import {
  requireOwnedProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import {
  reindexProject,
  StorageWriteError,
} from "@/lib/storage/write-path"

export const runtime = "nodejs"
export const maxDuration = 120

/** POST /api/storage/v1/reindex?projectId= — full LIST R2 vs cache. */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const projectId =
    request.nextUrl.searchParams.get("projectId")?.trim() ||
    ((await request.json().catch(() => null)) as { projectId?: string } | null)
      ?.projectId

  if (!projectId) {
    return NextResponse.json({ message: "projectId is required." }, { status: 400 })
  }

  const access = await requireOwnedProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  try {
    const stats = await reindexProject(access.projectId)
    return NextResponse.json({ ok: true, ...stats })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: 503 })
    }
    console.error("[storage] reindex failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Reindex failed." },
      { status: 503 },
    )
  }
}
