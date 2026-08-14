import { NextResponse } from "next/server"
import { z } from "zod"
import { ensureRemoteComputerByUuid } from "@/lib/repositories/remote-computers"
import {
  claimNextTask,
  completeTask,
  failTask,
  releaseTask,
  reportTaskProgress,
  type QueueCaller,
  type QueueMutationResult,
} from "@/lib/pipeline/queue"
import type { StorageApiAuth } from "@/lib/storage/auth"

/**
 * Общая логика очереди для обеих поверхностей: экшены на `POST /api/v1` (токен
 * `rc_…`) и REST под `/api/storage/v1/queue/*` (токен `mch_…`, которым десктоп
 * уже ходит). Тот же приём, что у общих словарей — одна логика, тонкие обёртки,
 * иначе поверхности разъедутся.
 *
 * Разные токены дают разную идентичность машины:
 *
 * - `rc_…` — компьютер заведён в админке, `computerId` приходит из токена;
 * - `mch_…` — компьютера в токене нет, машина присылает свой `machineUuid` и
 *   сайт заводит строку сам (PIPELINE_BACKEND_REQUESTS.md §4). Так десктопу не
 *   нужен второй токен в настройках.
 */

/** Идентификация машины, общая для обеих поверхностей. */
export const machineIdentitySchema = z.object({
  /**
   * UUID машины из её настроек. Обязателен, когда в токене нет компьютера
   * (`mch_…`); для `rc_…` — необязателен, но принимается и запоминается.
   */
  machineUuid: z.string().trim().min(8).max(64).optional(),
  /** Человекочитаемая подпись для админки. */
  hostname: z.string().trim().max(200).optional(),
})

export const claimTaskSchema = machineIdentitySchema.extend({
  /** На будущее: теги вроде ffmpeg / ae для гибридного роутинга. */
  capabilities: z.array(z.string().trim().max(40)).max(20).optional(),
})

export const taskProgressSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
  stepId: z.string().trim().min(1).max(200),
  status: z.enum(["running", "done", "error"]),
  message: z.string().max(2000).nullable().optional(),
})

export const taskDoneSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
  outFiles: z.array(z.string().max(1024)).max(500).optional(),
  totalCost: z.number().nonnegative().optional(),
})

export const taskFailedSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
  error: z.string().trim().min(1).max(4000),
})

export const releaseTaskSchema = machineIdentitySchema.extend({
  taskId: z.string().uuid(),
})

/**
 * Кто именно зовёт очередь.
 *
 * `NextResponse` — отказ: машину не удалось опознать. Это единственное место, где
 * решается идентичность, поэтому обе поверхности ведут себя одинаково.
 */
export async function resolveQueueCaller(
  auth: StorageApiAuth,
  props: { machineUuid?: string; hostname?: string },
): Promise<QueueCaller | NextResponse> {
  if (auth.computerId) {
    // Компьютер заведён в админке. Если он вдруг прислал UUID — запомним, чтобы
    // имя файла статистики совпало с тем, что машина пишет у себя.
    if (props.machineUuid) {
      await ensureRemoteComputerByUuid({
        machineUuid: props.machineUuid,
        hostname: props.hostname,
        userId: auth.userId,
      }).catch(() => {
        // Уже занят другой строкой — не повод отказывать в задаче.
      })
    }
    return {
      computerId: auth.computerId,
      userId: auth.userId,
      role: auth.role,
    }
  }

  if (!props.machineUuid) {
    return NextResponse.json(
      {
        message:
          "machineUuid is required: this token is not bound to a computer.",
      },
      { status: 400 },
    )
  }

  const computer = await ensureRemoteComputerByUuid({
    machineUuid: props.machineUuid,
    hostname: props.hostname,
    userId: auth.userId,
  })

  return { computerId: computer.id, userId: auth.userId, role: auth.role }
}

function mutationResponse(result: QueueMutationResult): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true })
  return NextResponse.json(
    {
      message:
        result.reason === "not-found"
          ? "Task not found."
          : "Task is held by another machine — its lease probably expired.",
    },
    { status: result.reason === "not-found" ? 404 : 409 },
  )
}

export async function handleClaimTask(
  auth: StorageApiAuth,
  props: z.infer<typeof claimTaskSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller

  const task = await claimNextTask(caller)
  // null — очередь пуста. Штатный ответ, а не ошибка: машина спрашивает каждые
  // 3 секунды и почти всегда получает именно его.
  return NextResponse.json({ task })
}

export async function handleTaskProgress(
  auth: StorageApiAuth,
  props: z.infer<typeof taskProgressSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  return mutationResponse(
    await reportTaskProgress({
      caller,
      taskId: props.taskId,
      stepId: props.stepId,
      status: props.status,
      message: props.message ?? null,
    }),
  )
}

export async function handleTaskDone(
  auth: StorageApiAuth,
  props: z.infer<typeof taskDoneSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  return mutationResponse(
    await completeTask({
      caller,
      taskId: props.taskId,
      outFiles: props.outFiles,
      totalCost: props.totalCost,
    }),
  )
}

export async function handleTaskFailed(
  auth: StorageApiAuth,
  props: z.infer<typeof taskFailedSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  return mutationResponse(
    await failTask({ caller, taskId: props.taskId, error: props.error }),
  )
}

export async function handleReleaseTask(
  auth: StorageApiAuth,
  props: z.infer<typeof releaseTaskSchema>,
): Promise<NextResponse> {
  const caller = await resolveQueueCaller(auth, props)
  if (caller instanceof NextResponse) return caller
  return mutationResponse(await releaseTask({ caller, taskId: props.taskId }))
}
