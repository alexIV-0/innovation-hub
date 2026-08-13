import type { ProjectRecord } from "@/lib/domain-types"
import {
  ProjectStorageError,
  projectFolderStateKey,
  setProjectAutomationEnabled,
  type ProjectFolderState,
} from "@/lib/project-storage"
import { updateProject } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import { journalStorageEvent } from "@/lib/storage/write-path"

/**
 * Тумблер слежения за проектом — единственная точка записи.
 *
 * Состояние живёт в двух хранилищах, и писать их по отдельности нельзя:
 *
 *   options/folderState.json на R2  — источник правды (docs/FOLDER_STATE_SSOT_PLAN.md).
 *                                     Его читает десктопное приложение прямо из папки.
 *   projects.is_paused в Postgres   — запрашиваемое зеркало. По нему считает
 *                                     сканер конвейера и рисует интерфейс:
 *                                     ходить в R2 на каждый тик нельзя.
 *
 * До появления этой функции пауза из кабинета писала только Postgres, а тумблер
 * автоматизации — только R2 (плюс legacy-колонку is_active), поэтому локальная
 * машина видела одно состояние, а сайт другое.
 *
 * Порядок записи:
 *
 *   1. R2      — источник правды меняется первым. Не получилось → выходим, ничего
 *                не тронув: расхождения не возникает вовсе.
 *   2. Postgres — кэш. Если упадёт здесь, кэш отстаёт от правды; починит
 *                reconcileProjectPauseFromFolderState на следующем чтении.
 *   3. Журнал   — последним и только после того, как сайдкар реально изменился.
 *                Десктоп узнаёт об изменении через delta (lib/storage/changes.ts),
 *                а getDelta не фильтрует ключи по префиксу, поэтому put по
 *                options/folderState.json доезжает наравне с обычными файлами.
 *                Без этого шага запись на R2 осталась бы для машины невидимой.
 */
export async function setProjectPaused(input: {
  projectId: string
  ownerId: string
  paused: boolean
  /** Кто менял — siteUpdatedBy(email) из lib/project-storage. */
  updatedBy: string
}): Promise<{ project: ProjectRecord; folderState: ProjectFolderState }> {
  if (!isS3Configured()) {
    throw new ProjectStorageError(
      "Object storage is not available for this project.",
    )
  }

  const folderState = await setProjectAutomationEnabled({
    userId: input.ownerId,
    projectId: input.projectId,
    enabled: !input.paused,
    updatedBy: input.updatedBy,
  })

  let project = await updateProject(input.projectId, input.ownerId, {
    isPaused: input.paused,
  })

  if (!project) {
    // Сайдкар уже переписан, а строки нет — проект удалили между вызовами.
    // Возвращать «не найдено» честнее, чем делать вид, что всё прошло.
    throw new ProjectStorageError("Project not found.")
  }

  await journalStorageEvent({
    projectId: input.projectId,
    key: projectFolderStateKey(input.ownerId, input.projectId),
    op: "put",
    payload: { name: "folderState.json", folderPath: "options" },
  })

  return { project, folderState }
}

/**
 * Подтягивает кэш в Postgres из источника правды на R2.
 *
 * Нужно на случай, когда folderState.json изменился в обход setProjectPaused
 * (ручная правка объекта, восстановление бакета, недоехавший шаг 2 выше).
 * Вызывается на чтении страницы проекта; если расхождения нет — ничего не делает
 * и не ходит в базу.
 */
export async function reconcileProjectPauseFromFolderState(input: {
  project: ProjectRecord
  folderState: ProjectFolderState | null
}): Promise<ProjectRecord> {
  const { project, folderState } = input
  if (!folderState) return project

  const pausedByFolderState = !folderState.enabled
  if (pausedByFolderState === project.isPaused) return project

  const synced = await updateProject(project.id, project.ownerId, {
    isPaused: pausedByFolderState,
  }).catch((error) => {
    console.error("[project-automation] pause cache hydration failed", error)
    return null
  })

  return synced ?? project
}

/**
 * Можно ли вообще обрабатывать проект, независимо от тумблера.
 *
 * Тумблер разрешает следить за папкой, но обрабатывать нечего, пока в проекте
 * нет options/options.json — граф обработки рисуется в десктопном приложении.
 * Поэтому в интерфейсе это отдельный индикатор, а не то же самое, что пауза.
 */
export function isProjectProcessable(input: {
  project: Pick<ProjectRecord, "isPaused" | "isArchived">
  optionsFileExists: boolean
  ownerAutomationEnabled: boolean
}): boolean {
  return (
    input.ownerAutomationEnabled &&
    input.optionsFileExists &&
    !input.project.isPaused &&
    !input.project.isArchived
  )
}
