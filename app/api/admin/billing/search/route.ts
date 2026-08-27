import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { searchProjects } from "@/lib/billing/reports"

export const runtime = "nodejs"

/** Поиск проекта, чтобы отметить его шаблоном пробного набора. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? ""
  // Пустой запрос — пустой список, а не всё подряд: страница открывается до
  // того, как в поле что-то напечатали.
  if (q.length < 2) return NextResponse.json({ projects: [] })

  return NextResponse.json({ projects: await searchProjects(q) })
}
