import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireAdminApi } from "@/lib/admin-auth"
import { countPipelineTasksByStatus } from "@/lib/pipeline/tasks"
import {
  readPipelineState,
  setPipelineRunning,
  setSweepInterval,
  SWEEP_INTERVAL_MAX,
  SWEEP_INTERVAL_OFF,
} from "@/lib/pipeline/state"

export const runtime = "nodejs"

/**
 * Состояние конвейера для нижней полосы страницы.
 *
 * Выбирать пользователя или проект не нужно: слежение всегда идёт по всем
 * включённым пользователям и всем их непаузнутым непроектам-архивам сразу.
 * Кнопка на странице — это одно состояние на всю установку.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const [state, counts] = await Promise.all([
    readPipelineState(),
    countPipelineTasksByStatus(),
  ])
  return NextResponse.json({ state, counts })
}

/**
 * Тумблер слежения и период обхода — одним роутом.
 *
 * Оба поля необязательные, но пустой запрос отвергаем: он значил бы «ничего не
 * менять» и отличить его от опечатки в имени поля было бы нечем.
 */
const patchSchema = z
  .object({
    running: z.boolean().optional(),
    /** Период обхода в минутах; 0 снимает расписание. */
    sweepIntervalMin: z
      .number()
      .int()
      .min(SWEEP_INTERVAL_OFF)
      .max(SWEEP_INTERVAL_MAX)
      .optional(),
  })
  .refine(
    (v) => v.running !== undefined || v.sweepIntervalMin !== undefined,
    { message: "Nothing to update." },
  )

/**
 * Запуск — начать слежение за папками и сборку объектов для обработки.
 * Стоп — прекратить и то, и другое. Уже созданные задачи остаются в очереди.
 *
 * Настройки страховочного обхода едут сюда же: они часть состояния конвейера, а
 * не общий словарь, и на десктоп не синхронизируются.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const { running, sweepIntervalMin } = parsed.data

  let state = await readPipelineState()
  if (sweepIntervalMin !== undefined) {
    state = await setSweepInterval(sweepIntervalMin)
  }
  if (running !== undefined) {
    state = await setPipelineRunning({ running, adminUserId: auth.userId })
  }

  const counts = await countPipelineTasksByStatus()
  return NextResponse.json({ state, counts })
}
