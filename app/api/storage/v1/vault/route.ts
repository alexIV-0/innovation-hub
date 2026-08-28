import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"
import { handleVendorKeys, handleVendorUsage } from "@/lib/vault/endpoint"
import { vendorKeysSchema, vendorUsageSchema } from "@/lib/vault/schemas"

export const runtime = "nodejs"

/**
 * Сейф для десктопа: он уже говорит с `/api/storage/v1/*` токеном `mch_…`, и
 * второй токен в настройках ему не нужен. Те же операции доступны экшенами
 * `vendorKeys` / `vendorUsage` на `POST /api/v1` для машин с `rc_…`.
 *
 * Один роут с полем `action`, как у очереди: две почти одинаковые точки входа
 * ради двух операций — лишние файлы.
 */

const HANDLERS = {
  keys: { schema: vendorKeysSchema, run: handleVendorKeys },
  usage: { schema: vendorUsageSchema, run: handleVendorUsage },
} as const

type Action = keyof typeof HANDLERS

/** POST /api/storage/v1/vault — `{ action: "keys" | "usage", …props }` */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const action = (body as { action?: string } | null)?.action
  if (!action || !(action in HANDLERS)) {
    return NextResponse.json(
      {
        message: `Unknown action. Expected one of: ${Object.keys(HANDLERS).join(", ")}.`,
      },
      { status: 400 },
    )
  }

  const handler = HANDLERS[action as Action]
  const parsed = handler.schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  // Типы схем разные, а обработчик у каждой свой — сужение безопасно: schema и
  // run в HANDLERS всегда парные.
  return (handler.run as (a: typeof auth, p: unknown) => Promise<NextResponse>)(
    auth,
    parsed.data,
  )
}
