import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"
import {
  applySettingsWrite,
  respondWithSettings,
} from "@/lib/settings-endpoint"
import { parseDomainsQuery, settingsWriteSchema } from "@/lib/settings-schemas"

export const runtime = "nodejs"

/**
 * Общие словари для десктопа — он уже говорит с `/api/storage/v1/*`
 * (fs.manager.tauri/src-tauri/src/storage/client.rs) токеном `mch_…`.
 * Контракт и правила слияния — docs/SETTINGS_SYNC.md.
 */

/** GET /api/storage/v1/settings?domains=fileType,nodeType */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  return respondWithSettings(
    parseDomainsQuery(request.nextUrl.searchParams.get("domains")),
  )
}

/** PUT /api/storage/v1/settings — `{ baseRevision, domains }`, 409 при расхождении. */
export async function PUT(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = settingsWriteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  return applySettingsWrite(
    {
      userId: auth.userId,
      role: auth.role,
      isMachine: Boolean(auth.machineTokenId || auth.computerId),
    },
    parsed.data,
  )
}
