import { NextResponse, type NextRequest } from "next/server"
import {
  requireProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { getLatestCursor } from "@/lib/storage/changes"
import { buildDisplayPath, loadDisplayContext } from "@/lib/storage/display-path"
import { loadStorageTree } from "@/lib/storage/tree"

export const runtime = "nodejs"

/** GET /api/storage/v1/tree?projectId=&prefix= */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  if (!projectId) {
    return NextResponse.json({ message: "projectId is required." }, { status: 400 })
  }

  const access = await requireProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  const prefix = request.nextUrl.searchParams.get("prefix") ?? ""
  const [entries, cursor, display] = await Promise.all([
    loadStorageTree({ projectId: access.projectId, prefix }),
    getLatestCursor(access.projectId),
    loadDisplayContext(access.projectId),
  ])

  return NextResponse.json({
    entries: display
      ? entries.map((e) => ({
          ...e,
          displayPath: buildDisplayPath(display, e.folderPath, e.name),
        }))
      : entries,
    cursor,
  })
}
