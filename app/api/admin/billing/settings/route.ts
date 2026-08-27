import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { billingSettingsWriteSchema } from "@/lib/billing/schemas"
import { readBillingSettings, writeBillingSettings } from "@/lib/billing/settings"

export const runtime = "nodejs"

/**
 * Тарифы: ставки, маржа, пороги, овердрафт, тестовый период, рубильник.
 *
 * Один документ, а не таблица ставок: это одно распоряжение, и меняется оно
 * целиком. Ревизия — оптимистическая блокировка, тот же приём, что у общих
 * словарей конвейера. Прошлые списания правка не трогает: применённые ставка,
 * курс и процент уже лежат в транзакциях.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const { settings, revision } = await readBillingSettings()
  return NextResponse.json({ settings, revision })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = billingSettingsWriteSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid settings.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const result = await writeBillingSettings({
    settings: parsed.data.settings,
    baseRevision: parsed.data.baseRevision,
    actorUserId: auth.userId,
  })

  if (!result.ok) {
    // 409, а не 200 с чужим документом: клиент должен показать, что его правку
    // не приняли, а не молча подменить форму актуальными значениями.
    return NextResponse.json(
      { message: "Settings changed elsewhere.", ...result },
      { status: 409 },
    )
  }

  return NextResponse.json(result)
}
