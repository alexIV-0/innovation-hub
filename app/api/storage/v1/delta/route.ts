import { NextResponse, type NextRequest } from "next/server"
import {
  requireProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { getDelta } from "@/lib/storage/changes"
import { serializeStorageChange } from "@/lib/storage/delta-format"
import { loadDisplayContext } from "@/lib/storage/display-path"
import { readSettingsRevision } from "@/lib/repositories/automation-settings"

export const runtime = "nodejs"

/** GET /api/storage/v1/delta?projectId=&since= */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  if (!projectId) {
    return NextResponse.json({ message: "projectId is required." }, { status: 400 })
  }

  const sinceRaw = request.nextUrl.searchParams.get("since") ?? "0"
  const since = Number.parseInt(sinceRaw, 10)
  if (!Number.isFinite(since) || since < 0) {
    return NextResponse.json({ message: "Invalid since cursor." }, { status: 400 })
  }

  const access = await requireProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  const [delta, display, settingsRevision] = await Promise.all([
    getDelta({ projectId: access.projectId, since }),
    loadDisplayContext(access.projectId),
    readSettingsRevision(),
  ])
  return NextResponse.json({
    changes: delta.changes.map((c) => serializeStorageChange(c, display)),
    cursor: delta.cursor,
    truncated: delta.truncated,
    // Ревизия общих словарей (docs/SETTINGS_SYNC.md §7). Едет здесь, а не
    // отдельным поллингом: демон десктопа дёргает delta каждые 3 секунды, и
    // сравнение счётчика — это ноль дополнительных запросов. Счётчик глобальный,
    // от проекта не зависит.
    settingsRevision,
  })
}
