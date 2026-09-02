import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireUserApi } from "@/lib/admin-auth"
import { VaultKeyError } from "@/lib/vault/crypto"
import {
  createAccount,
  listAccountsForOwner,
  listServicesForOwner,
} from "@/lib/vault/services"

export const runtime = "nodejs"

/**
 * «Мои ключи» — учётки внешних сервисов, принадлежащие самому человеку
 * (VENDOR_KEYS_CLIENT_REQUESTS, 7.1).
 *
 * ⚠️ Это НЕ админский `/api/admin/services/[id]/accounts`. Там мы распоряжаемся
 * студийными ключами по тегу `services.manage`; здесь человек распоряжается
 * своими и видит только свои. Механика та же, права другие — и поэтому это
 * отдельный файл, а не флаг в существующем роуте: один общий обработчик с
 * ветвлением по роли однажды пропустил бы чужую учётку наружу.
 *
 * Ключ у клиента ОДИН НА ВСЕ ЕГО ПРОЕКТЫ — в этом весь смысл экрана: завёл
 * однажды, работает везде. Заводить его только изнутри проекта означало бы
 * «найди тот проект, где я его вводил», и то же самое при замене и отзыве.
 */
const createSchema = z.object({
  serviceId: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(64).default("main"),
  fields: z.record(z.string().trim().min(1).max(48), z.string().min(1).max(8192)),
})

export async function GET(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const [accounts, services] = await Promise.all([
    listAccountsForOwner(auth.userId),
    listServicesForOwner(),
  ])
  return NextResponse.json({ accounts, services })
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  // Сервис должен быть из открытого списка: иначе по прямому id можно было бы
  // прицепиться к отозванному или к `proxy`, где чужой ключ нам не нужен вовсе.
  const services = await listServicesForOwner()
  if (!services.some((service) => service.id === parsed.data.serviceId)) {
    return NextResponse.json({ code: "service-not-found" }, { status: 404 })
  }

  try {
    const result = await createAccount({
      serviceId: parsed.data.serviceId,
      label: parsed.data.label,
      // Владелец — всегда сам вызывающий. Поля «чей ключ» здесь нет и быть не
      // может: иначе человек завёл бы учётку от чужого имени.
      ownerUserId: auth.userId,
      fields: parsed.data.fields,
      actorId: auth.userId,
    })
    if (!result) {
      return NextResponse.json({ code: "service-not-found" }, { status: 404 })
    }
    if ("conflict" in result) {
      return NextResponse.json({ code: "label-taken" }, { status: 409 })
    }
    return NextResponse.json({ id: result.id }, { status: 201 })
  } catch (error) {
    if (error instanceof VaultKeyError) {
      return NextResponse.json({ code: "vault-not-configured" }, { status: 503 })
    }
    throw error
  }
}
