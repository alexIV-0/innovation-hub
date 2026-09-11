import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { isSuperAdmin } from "@/lib/admin-roles"
import {
  COMPANY_CAPABILITIES,
  hasCompanyCapability,
  type CompanyCapability,
} from "@/lib/company-capabilities"
import { listCompanyCapabilitiesFor } from "@/lib/repositories/company-capabilities"
import { findCompanyById, listCompanies } from "@/lib/repositories/companies"
import { findUserById } from "@/lib/repositories/users"
import type { CompanyRole } from "@/lib/domain-types"

/**
 * Гейт консоли компании — docs/COMPANY_ACCOUNTS_PLAN.md §6.2.
 *
 * Отдельная поверхность, а не ограничения в нашей админке (§6.1): у админов
 * компании своя ось прав, а в `/admin` их не пускает `proxy.ts`.
 *
 * ГЛАВНОЕ СВОЙСТВО: гейт **всегда** возвращает `companyId`, и вызвать функцию
 * консоли без него нельзя по типу. Это то, на чём держится изоляция: забыть
 * фильтр по компании можно только выбросив сам результат гейта, а это видно
 * глазами. Вторая страховка — `npm run company:check`: роут под `app/api/company`
 * без гейта не проходит проверку.
 *
 * Суперадмин действует в консоли как владелец любой компании, с переключателем
 * (§4). Выбор живёт в куке, а не в адресе: иначе ссылка, отправленная коллеге,
 * открывала бы ему чужую компанию, а не ту, в которой работает он.
 */

export const COMPANY_SCOPE_COOKIE = "company-scope"

export type CompanyContext = {
  userId: string
  email: string
  companyId: string
  companyTitle: string
  /**
   * Роль в компании. У суперадмина, зашедшего через переключатель, — `owner`:
   * он и есть владелец по полномочиям, а отдельной четвёртой роли заводить
   * незачем — она размножила бы проверки.
   */
  companyRole: CompanyRole
  capabilities: CompanyCapability[]
  /** Суперадмин сайта смотрит чужую компанию: показываем переключатель. */
  isSiteSuperAdmin: boolean
}

type Resolution =
  | { ok: true; context: CompanyContext }
  | { ok: false; reason: "unauthorized" | "no-company" | "inactive" }

/**
 * Кто смотрит и в какой компании. Общая часть обоих гвардов — и API, и страниц.
 *
 * Порядок веток значим: своя компания сотрудника проверяется ПЕРЕД
 * переключателем суперадмина. Человек, который и суперадмин сайта, и владелец
 * своей компании, должен по умолчанию попадать в свою, а не в первую попавшуюся.
 */
async function resolve(token: string | undefined): Promise<Resolution> {
  if (!token) return { ok: false, reason: "unauthorized" }

  const session = await verifySessionToken(token)
  if (!session?.userId) return { ok: false, reason: "unauthorized" }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) return { ok: false, reason: "unauthorized" }

  if (user.companyId && user.companyRole) {
    const company = await findCompanyById(user.companyId)
    if (!company) return { ok: false, reason: "no-company" }
    // Выключенная компания закрыта и для своих: пауза должна что-то означать,
    // иначе она только вводит в заблуждение. Владельцу и суперадмину вход
    // оставляем — им же её и включать обратно.
    if (!company.isActive && user.companyRole !== "owner" && !isSuperAdmin(user.role)) {
      return { ok: false, reason: "inactive" }
    }
    // Участник консоли не видит вовсе (§4): она про распоряжение, а он в ней
    // ничем не распоряжается.
    if (user.companyRole === "member") return { ok: false, reason: "no-company" }

    return {
      ok: true,
      context: {
        userId: user.id,
        email: user.email,
        companyId: company.id,
        companyTitle: company.title,
        companyRole: user.companyRole,
        capabilities:
          user.companyRole === "owner"
            ? [...COMPANY_CAPABILITIES]
            : await listCompanyCapabilitiesFor(user.id),
        isSiteSuperAdmin: isSuperAdmin(user.role),
      },
    }
  }

  if (!isSuperAdmin(user.role)) return { ok: false, reason: "no-company" }

  // Суперадмин вне компании: смотрит выбранную переключателем, иначе первую.
  const cookieStore = await cookies()
  const picked = cookieStore.get(COMPANY_SCOPE_COOKIE)?.value
  const company = picked ? await findCompanyById(picked) : null
  const fallback = company ?? (await listCompanies())[0] ?? null
  if (!fallback) return { ok: false, reason: "no-company" }

  return {
    ok: true,
    context: {
      userId: user.id,
      email: user.email,
      companyId: fallback.id,
      companyTitle: fallback.title,
      companyRole: "owner",
      capabilities: [...COMPANY_CAPABILITIES],
      isSiteSuperAdmin: true,
    },
  }
}

/**
 * Контекст для оболочки и страниц. Обёрнут в `React.cache`: layout и page
 * спрашивают его порознь, а платим за рендер один раз — как `getCurrentUser`.
 */
export const getCompanyContext = cache(async (): Promise<CompanyContext | null> => {
  const cookieStore = await cookies()
  const resolved = await resolve(cookieStore.get(SESSION_COOKIE_NAME)?.value)
  return resolved.ok ? resolved.context : null
})

/**
 * Гвард страницы консоли.
 *
 * Тег обязателен без умолчания — ровно по той же причине, что у
 * `requireAdminApi`: новая страница без решения о теге просто не соберётся.
 * Редирект, а не 403: раздела для этого человека не существует.
 */
export async function requireCompanyPage(
  capability: CompanyCapability,
): Promise<CompanyContext> {
  const context = await getCompanyContext()
  if (!context) redirect("/account")
  if (!hasCompanyCapability(context.companyRole, context.capabilities, capability)) {
    redirect("/company")
  }
  return context
}

/** Страница, открытая всем админам компании: журнал (§6.4). */
export async function requireCompanyMember(): Promise<CompanyContext> {
  const context = await getCompanyContext()
  if (!context) redirect("/account")
  return context
}

/**
 * Гвард роутов консоли. Идиома прежняя — «либо данные, либо готовый ответ».
 */
export async function requireCompanyApi(
  request: NextRequest,
  capability: CompanyCapability,
): Promise<CompanyContext | NextResponse> {
  const resolved = await resolve(request.cookies.get(SESSION_COOKIE_NAME)?.value)

  if (!resolved.ok) {
    if (resolved.reason === "unauthorized") {
      return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
    }
    if (resolved.reason === "inactive") {
      return NextResponse.json({ message: "This company is disabled." }, { status: 403 })
    }
    return NextResponse.json({ message: "Company access required." }, { status: 403 })
  }

  const { context } = resolved
  if (!hasCompanyCapability(context.companyRole, context.capabilities, capability)) {
    return NextResponse.json(
      { message: "You don't have access to this section." },
      { status: 403 },
    )
  }
  return context
}

/**
 * Роут консоли, открытый любому её админу: журнал компании.
 *
 * Отдельная функция, а не `capability?`: умолчание в гварде — это ровно то, от
 * чего защищает обязательный аргумент. Здесь решение принято и названо.
 */
export async function requireCompanyApiAnyAdmin(
  request: NextRequest,
): Promise<CompanyContext | NextResponse> {
  const resolved = await resolve(request.cookies.get(SESSION_COOKIE_NAME)?.value)
  if (!resolved.ok) {
    const status = resolved.reason === "unauthorized" ? 401 : 403
    return NextResponse.json({ message: "Company access required." }, { status })
  }
  return resolved.context
}
