import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { createGrant } from "@/lib/billing/grants"
import {
  listUserGrants,
  listUserProjects,
  readOverdraftLimit,
  searchUsers,
  setOverdraftLimit,
} from "@/lib/billing/reports"

export const runtime = "nodejs"

/**
 * Акции и адресные подарки.
 *
 * Отдельный тег `billing.promo`, а не общий `billing.manage`: раздача денег
 * конкретным людям и переписывание прайса для всего сайта — разные полномочия,
 * и совмещать их в одном теге означало бы, что человеку, которому доверили
 * начислять акции, заодно открыт тариф.
 *
 * Ограничение «один раз на человека» здесь НЕ действует: оно про
 * самообслуживание по кнопке, а не про распоряжение администратора.
 */
const createSchema = z.object({
  userId: z.string().min(1),
  amountCents: z.number().int().positive().max(1e11),
  lifetimeDays: z.number().int().min(1).max(3650).nullable(),
  /** Пустой список — подарок действует в любом проекте этого человека. */
  projectIds: z.array(z.string().min(1)).max(200),
  comment: z.string().trim().max(500),
})

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const userId = request.nextUrl.searchParams.get("userId")
  if (userId) {
    const [projects, grants, overdraftLimitCents] = await Promise.all([
      listUserProjects(userId),
      listUserGrants(userId),
      readOverdraftLimit(userId),
    ])
    return NextResponse.json({ projects, grants, overdraftLimitCents })
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  // Пустой запрос — пустой список, а не все пользователи разом: экран
  // открывают, чтобы подарить конкретному человеку, а не полистать базу.
  if (q.length < 2) return NextResponse.json({ users: [] })
  return NextResponse.json({ users: await searchUsers(q) })
}

/**
 * Персональный лимит овердрафта.
 *
 * Живёт здесь, а не в «Тарифах»: тариф — правило для всего сайта, а разрешить
 * ЭТОМУ человеку уйти в минус на пять тысяч — решение про него, и по риску оно
 * ровно того же порядка, что подарить ему эти пять тысяч. Значит и тег тот же.
 */
const overdraftSchema = z.object({
  userId: z.string().min(1),
  /** `null` — вернуть человека под общий лимит из «Тарифов». */
  limitCents: z.number().int().min(0).max(1e11).nullable(),
})

export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const parsed = overdraftSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  await setOverdraftLimit(parsed.data)
  return NextResponse.json({ ok: true })
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.promo")
  if (auth instanceof NextResponse) return auth

  const parsed = createSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", issues: parsed.error.issues },
      { status: 400 },
    )
  }

  const grant = await createGrant({
    userId: parsed.data.userId,
    kind: "targeted",
    amountCents: parsed.data.amountCents,
    lifetimeDays: parsed.data.lifetimeDays,
    projectIds: parsed.data.projectIds,
    grantedBy: auth.userId,
    comment: parsed.data.comment,
    // Адресный подарок начисляется сразу: проекты уже существуют, тратить есть
    // где, ждать нечего.
    activateNow: true,
  })

  if (!grant) {
    return NextResponse.json({ message: "Grant was not created." }, { status: 409 })
  }
  return NextResponse.json({ grant }, { status: 201 })
}
