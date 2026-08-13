import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { collectTasks } from "@/lib/pipeline/scan"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * Разовый прогон сборки задач — для диагностики.
 *
 * В интерфейсе этой кнопки нет: слежением управляет тумблер на странице, а
 * собирает задачи фоновый цикл (lib/pipeline/runner.ts). Роут оставлен потому,
 * что он единственный способ прогнать сборку один раз и увидеть подробный
 * результат: сколько событий просмотрено, что создано и какие проекты пропущены
 * с причинами. Цикл столько не рассказывает — он пишет в состояние только итог.
 *
 * Задачи здесь только создаются; выдача машинам появится отдельными экшенами в
 * POST /api/v1 (claimTask и далее).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  try {
    const result = await collectTasks()
    return NextResponse.json(result)
  } catch (error) {
    console.error("[pipeline] collect failed", error)
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Failed to collect tasks.",
      },
      { status: 503 },
    )
  }
}
