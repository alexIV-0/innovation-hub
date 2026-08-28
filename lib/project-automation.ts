import type { ProjectRecord } from "@/lib/domain-types"
import {
  FOLDER_STATE_FILE_NAME,
  ProjectStorageError,
  projectFolderStateKey,
  setProjectAutomationEnabled,
  type ProjectFolderState,
} from "@/lib/project-storage"
import { updateProject } from "@/lib/repositories/projects"
import { isS3Configured } from "@/lib/s3-client"
import { writeSidecarSync } from "@/lib/storage/write-path"

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
 *   3. Каталог  — последним и только после того, как сайдкар реально изменился:
 *                строка в project_files плюс событие в журнале. Десктоп узнаёт об
 *                изменении через delta (lib/storage/changes.ts), а getDelta не
 *                фильтрует ключи по префиксу, поэтому put по
 *                options/folderState.json доезжает наравне с обычными файлами.
 *                Без этого шага запись на R2 осталась бы для машины невидимой, а
 *                сам файл — вне дерева: сайдкары пишутся минуя presign/notify,
 *                поэтому строку им создаёт только writeSidecarSync.
 */
export async function setProjectPaused(input: {
  projectId: string
  /** Владелец: по нему обновляется строка проекта (WHERE user_id = …). */
  ownerId: string
  /**
   * `projects.storage_owner_id` — по нему строится ключ сайдкара. У переданного
   * проекта не равен `ownerId`, и подстановка владельца записала бы folderState
   * туда, где его никто не читает.
   */
  storageOwnerId: string
  paused: boolean
  /** Кто менял — siteUpdatedBy(email) из lib/project-storage. */
  updatedBy: string
  /** Действующее лицо для журнала; владельцем проекта быть не обязано. */
  actorUserId?: string | null
}): Promise<{ project: ProjectRecord; folderState: ProjectFolderState }> {
  if (!isS3Configured()) {
    throw new ProjectStorageError(
      "Object storage is not available for this project.",
    )
  }

  const folderState = await setProjectAutomationEnabled({
    storageOwnerId: input.storageOwnerId,
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

  await writeSidecarSync({
    storageOwnerId: input.storageOwnerId,
    projectId: input.projectId,
    key: projectFolderStateKey(input.storageOwnerId, input.projectId),
    name: FOLDER_STATE_FILE_NAME,
    actor: input.actorUserId ? { userId: input.actorUserId } : null,
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
