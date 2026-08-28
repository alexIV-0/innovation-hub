import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { listProjectsWithoutSitePayUnit } from "@/lib/billing/projects"

export const runtime = "nodejs"

/**
 * Проекты, у которых не задано, за что списывать средства.
 *
 * ⚠️ Список НЕПОЛНЫЙ, и это записано прямо в интерфейсе: оси мог объявить сам
 * граф, и такой проект попадёт сюда напрасно. Полный ответ даёт разовый прогон
 * сборки — он читает `options.json` и возвращает `unpriced`. Выдать эту выборку
 * за аудит значило бы обещать больше, чем она знает.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  return NextResponse.json({ projects: await listProjectsWithoutSitePayUnit() })
}
