import { NextResponse, type NextRequest } from "next/server"
import { requireStorageApi } from "@/lib/storage/auth"
import {
  claimTaskSchema,
  handleClaimTask,
  handleReleaseTask,
  handleTaskDone,
  handleTaskFailed,
  handlePing,
  handleTaskProgress,
  machineIdentitySchema,
  releaseTaskSchema,
  taskDoneSchema,
  taskFailedSchema,
  taskProgressSchema,
} from "@/lib/pipeline/queue-endpoint"

export const runtime = "nodejs"

/**
 * Очередь задач для десктопа: он уже говорит с `/api/storage/v1/*` токеном
 * `mch_…`, и второй токен в настройках ему не нужен — машина опознаётся своим
 * `machineUuid` (PIPELINE_BACKEND_REQUESTS.md §4).
 *
 * Один роут с полем `action`, а не пять путей: демон дёргает claim на каждом
 * пульсе, и держать пять почти одинаковых файлов ради этого незачем. Те же
 * операции доступны экшенами на `POST /api/v1` для машин с токеном `rc_…`.
 */

const HANDLERS = {
  // ping — «я на связи», без запроса задачи. Звать на пульсе синхронизации
  // независимо от воркера: иначе состояние «машина включена, воркер выключен»
  // сайту не видно вовсе.
  ping: { schema: machineIdentitySchema, run: handlePing },
  claim: { schema: claimTaskSchema, run: handleClaimTask },
  progress: { schema: taskProgressSchema, run: handleTaskProgress },
  done: { schema: taskDoneSchema, run: handleTaskDone },
  failed: { schema: taskFailedSchema, run: handleTaskFailed },
  release: { schema: releaseTaskSchema, run: handleReleaseTask },
} as const

type Action = keyof typeof HANDLERS

/** POST /api/storage/v1/queue — `{ action: "claim" | "progress" | …, …props }` */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const action = (body as { action?: string } | null)?.action
  if (!action || !(action in HANDLERS)) {
    return NextResponse.json(
      {
        message: `Unknown action. Expected one of: ${Object.keys(HANDLERS).join(", ")}.`,
      },
      { status: 400 },
    )
  }

  const handler = HANDLERS[action as Action]
  const parsed = handler.schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  // Типы схем разные, а обработчик у каждой свой — сужение здесь безопасно:
  // schema и run в HANDLERS всегда парные.
  return (handler.run as (a: typeof auth, p: unknown) => Promise<NextResponse>)(
    auth,
    parsed.data,
  )
}
