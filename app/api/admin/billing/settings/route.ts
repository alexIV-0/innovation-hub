import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { billingRulesWriteSchema } from "@/lib/billing/schemas"
import { readLatestRate } from "@/lib/billing/rates"
import { readBillingSettings, writeBillingSettings } from "@/lib/billing/settings"

export const runtime = "nodejs"

/**
 * Тарифы: ставки, маржа, курс, пороги, овердрафт, рубильник.
 *
 * Тестовый период сюда НЕ входит — у него свой тег и свой роут
 * (`/api/admin/billing/trial`). Запись здесь его поля не трогает: документ
 * настроек один, но распоряжаются им двое.
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
  // Курс отдаём вместе с настройками: увидеть, по какому именно числу сейчас
  // пересчитывается себестоимость, важнее, чем знать, что он «где-то есть».
  const rate = await readLatestRate(settings.vendorCurrency)
  return NextResponse.json({ settings, revision, rate })
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = billingRulesWriteSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid settings.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  // Читаем текущее и подставляем чужую половину: тариф не должен уметь
  // переписать период, даже случайно.
  const current = await readBillingSettings()
  const result = await writeBillingSettings({
    settings: { ...parsed.data.settings, trial: current.settings.trial },
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
