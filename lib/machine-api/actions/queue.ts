import { defineAction } from "@/lib/machine-api/types"
import {
  claimTaskSchema,
  handleClaimTask,
  handleReleaseTask,
  handleTaskDone,
  handleTaskFailed,
  handleTaskProgress,
  releaseTaskSchema,
  taskDoneSchema,
  taskFailedSchema,
  taskProgressSchema,
} from "@/lib/pipeline/queue-endpoint"

/**
 * Очередь на машинном API. Логика — в lib/pipeline/queue-endpoint.ts, здесь
 * только привязка схем к экшенам: тот же контракт доступен и под
 * `/api/storage/v1/queue/*`, которым ходит десктоп.
 */

export const claimTaskAction = defineAction(claimTaskSchema, handleClaimTask)
export const taskProgressAction = defineAction(
  taskProgressSchema,
  handleTaskProgress,
)
export const taskDoneAction = defineAction(taskDoneSchema, handleTaskDone)
export const taskFailedAction = defineAction(taskFailedSchema, handleTaskFailed)
export const releaseTaskAction = defineAction(
  releaseTaskSchema,
  handleReleaseTask,
)
