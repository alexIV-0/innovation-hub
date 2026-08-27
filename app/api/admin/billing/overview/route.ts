import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import {
  listProjectsWithoutSitePayUnit,
  listTemplateProjects,
} from "@/lib/billing/projects"
import { listTemplateCosts, listTrialActivations } from "@/lib/billing/reports"

export const runtime = "nodejs"

/**
 * Наблюдение в «Тарифах»: пробный набор, активации, проекты без единицы.
 *
 * Одним ответом, а не тремя запросами: это один экран, и три отдельные загрузки
 * дали бы три состояния «ещё едет» на одной странице.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "billing.manage")
  if (auth instanceof NextResponse) return auth

  const templates = await listTemplateProjects()
  const [costs, activations, unpriced] = await Promise.all([
    listTemplateCosts(templates.map((t) => t.projectId)),
    listTrialActivations(),
    listProjectsWithoutSitePayUnit(),
  ])

  return NextResponse.json({
    templates: templates.map((t) => ({
      ...t,
      cost: costs.get(t.projectId) ?? null,
    })),
    activations,
    // ⚠️ Не полный ответ на «что нечем тарифицировать»: граф мог объявить оси
    // сам, и такой проект попадёт сюда напрасно. Полный список даёт разовый
    // прогон сборки — он читает options.json и возвращает `unpriced`.
    unpriced,
  })
}
