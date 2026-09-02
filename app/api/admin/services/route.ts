import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { auditFrom } from "@/lib/audit"
import { vaultConfigured, VaultKeyError } from "@/lib/vault/crypto"
import { createServiceSchema } from "@/lib/vault/schemas"
import { createService, listServices } from "@/lib/vault/services"

export const runtime = "nodejs"

/**
 * Внешние сервисы: список и заведение нового.
 *
 * Тег `services.manage`, а не `billing.manage`: доступ к ключам от чужих
 * кошельков и право переписать наш прайс — разные полномочия. Тот же принцип,
 * по которому уже разведены три биллинговых тега.
 *
 * ⚠️ Секрет наружу не отдаётся ни одним методом этого файла. В списке — версия
 * и подсказка «••••4f21»; сам ключ уходит только машинам, через `vendorKeys`.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({
    services: await listServices(),
    // Экран обязан сказать, что мастер-ключа нет, ДО того как человек заполнит
    // форму: иначе он введёт ключ вендора и получит отказ на кнопке.
    vaultConfigured: vaultConfigured(),
  })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "services.manage")
  if (auth instanceof NextResponse) return auth

  const parsed = createServiceSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const result = await createService({ ...parsed.data, createdBy: auth.userId })
    if ("conflict" in result) {
      // 409, а не 400: слаг занят — это состояние базы, а не ошибка формы.
      return NextResponse.json({ code: "slug-taken" }, { status: 409 })
    }

    // В журнал уходит всё, кроме секрета. Даже подсказку не пишем: журнал
    // читают шире, чем экран сервисов.
    await auditFrom(request, auth)({
      action: "service.created",
      targetType: "service",
      targetId: result.id,
      targetLabel: parsed.data.name,
      meta: {
        slug: parsed.data.slug,
        baseUrl: parsed.data.baseUrl,
        currency: parsed.data.currency,
        delivery: parsed.data.delivery,
        // Учётки нет — это решение, а не пропуск, и в журнале оно должно быть
        // видно: сервис без авторизации отвечает всем, кто знает адрес.
        account: parsed.data.account?.label ?? null,
      },
    })

    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (error) {
    // Мастер-ключа нет или он не той длины — это настройка сервера, и человеку
    // в админке надо сказать именно это, а не «внутренняя ошибка».
    if (error instanceof VaultKeyError) {
      return NextResponse.json({ code: "vault-not-configured" }, { status: 503 })
    }
    throw error
  }
}
