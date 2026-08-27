import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
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
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  return respondWithSettings(
    parseDomainsQuery(request.nextUrl.searchParams.get("domains")),
  )
}

/** PATCH /api/admin/settings — `{ baseRevision, domains }`, 409 при расхождении. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "settings.write")
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

  // requireAdminApi уже отсеял всех, кто ниже админа; роль передаём настоящую,
  // а не литералом — иначе проверка внутри смотрела бы на выдуманное значение.
  const response = await applySettingsWrite(
    { userId: auth.userId, role: auth.role, isMachine: false },
    parsed.data,
  )

  // Словари разъезжаются на весь парк машин, поэтому правка попадает в журнал.
  // Логируем только удавшуюся: 409 при расхождении ревизий ничего не изменил.
  if (response.ok) {
    await auditFrom(request, auth)({
      action: "settings.updated",
      targetType: "settings",
      meta: {
        baseRevision: parsed.data.baseRevision,
        domains: Object.keys(parsed.data.domains ?? {}),
      },
    })
  }

  return response
}
