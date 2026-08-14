import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  applySettingsWrite,
  respondWithSettings,
} from "@/lib/settings-endpoint"
import { parseDomainsQuery, settingsWriteSchema } from "@/lib/settings-schemas"

export const runtime = "nodejs"

/**
 * Общие словари для браузера — страница настроек конвейера.
 * Контракт тот же, что у машинных поверхностей: docs/SETTINGS_SYNC.md §7.
 */

/** GET /api/admin/settings?domains=fileType,nodeType */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  return respondWithSettings(
    parseDomainsQuery(request.nextUrl.searchParams.get("domains")),
  )
}

/** PATCH /api/admin/settings — `{ baseRevision, domains }`, 409 при расхождении. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request)
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

  // requireAdminApi уже отсеял всех, кроме ADMIN, и роль в ответе не возвращает.
  return applySettingsWrite(
    { userId: auth.userId, role: "ADMIN", isMachine: false },
    parsed.data,
  )
}
