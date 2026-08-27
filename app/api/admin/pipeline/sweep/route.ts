import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { readPipelineState, recordSweepResult } from "@/lib/pipeline/state"
import { sweepInFolders } from "@/lib/pipeline/sweep"

export const runtime = "nodejs"
export const maxDuration = 120

/**
 * Разовый обход папок IN по кнопке «Обойти сейчас».
 *
 * Нужен не только для диагностики, в отличие от /collect: обход по расписанию
 * ждёт своего интервала, а «файл лежит и не обработан» обычно выясняется прямо
 * сейчас — после починки options.json, снятия паузы или деплоя. Кнопка избавляет
 * от выбора между «ждать четверть часа» и «идти в базу руками».
 *
 * Итог пишем в то же состояние, что и цикл: расписание считается от конца
 * ЛЮБОГО обхода, поэтому ручной прогон честно сдвигает следующий автоматический,
 * а не идёт вдобавок к нему через минуту.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "pipeline.operate")
  if (auth instanceof NextResponse) return auth

  // Обход подчинён тумблеру слежения так же, как событийная сборка: пока стоит
  // «Стоп», задачи не появляются вообще — иначе кнопка в настройках обходила бы
  // решение, принятое на самой странице.
  const state = await readPipelineState()
  if (!state.isRunning) {
    return NextResponse.json(
      { message: "Pipeline is stopped — start watching first." },
      { status: 409 },
    )
  }

  try {
    const result = await sweepInFolders()
    await recordSweepResult({ created: result.created, error: null })
    return NextResponse.json(result)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to sweep IN folders."
    console.error("[pipeline] sweep failed", error)
    await recordSweepResult({ created: 0, error: message }).catch(() => {})
    return NextResponse.json({ message }, { status: 503 })
  }
}
