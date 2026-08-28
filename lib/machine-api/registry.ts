import type { MachineActionHandler } from "@/lib/machine-api/types"
import { heartbeatAction, meAction } from "@/lib/machine-api/actions/computer"
import {
  capabilitiesAction,
  deltaAction,
  getSidecarAction,
  treeAction,
} from "@/lib/machine-api/actions/storage-read"
import {
  createProjectAction,
  deleteProjectAction,
  projectRenameAction,
  projectStateAction,
  projectsAction,
  restoreProjectAction,
} from "@/lib/machine-api/actions/storage-projects"
import {
  copyAction,
  deleteObjectAction,
  getJobAction,
  mkdirAction,
  notifyAction,
  presignAction,
  putSidecarAction,
  reindexAction,
  renameAction,
} from "@/lib/machine-api/actions/storage-write"
import {
  multipartAbortAction,
  multipartCompleteAction,
  multipartCreateAction,
  multipartPresignPartAction,
} from "@/lib/machine-api/actions/storage-multipart"
import {
  getSettingsAction,
  putSettingsAction,
} from "@/lib/machine-api/actions/settings"
import {
  vendorKeysAction,
  vendorUsageAction,
} from "@/lib/machine-api/actions/vault"
import {
  claimTaskAction,
  machinePingAction,
  releaseTaskAction,
  taskDoneAction,
  taskFailedAction,
  taskProgressAction,
} from "@/lib/machine-api/actions/queue"
import { MACHINE_API_ACTIONS } from "@/lib/machine-api/catalog"

export const ACTION_REGISTRY: Record<string, MachineActionHandler> = {
  me: meAction,
  heartbeat: heartbeatAction,
  capabilities: capabilitiesAction,
  projects: projectsAction,
  createProject: createProjectAction,
  projectRename: projectRenameAction,
  projectState: projectStateAction,
  deleteProject: deleteProjectAction,
  restoreProject: restoreProjectAction,
  tree: treeAction,
  delta: deltaAction,
  presign: presignAction,
  notify: notifyAction,
  mkdir: mkdirAction,
  rename: renameAction,
  copy: copyAction,
  deleteObject: deleteObjectAction,
  reindex: reindexAction,
  getSidecar: getSidecarAction,
  putSidecar: putSidecarAction,
  getJob: getJobAction,
  multipartCreate: multipartCreateAction,
  multipartPresignPart: multipartPresignPartAction,
  multipartComplete: multipartCompleteAction,
  multipartAbort: multipartAbortAction,
  getSettings: getSettingsAction,
  putSettings: putSettingsAction,
  vendorKeys: vendorKeysAction,
  vendorUsage: vendorUsageAction,
  machinePing: machinePingAction,
  claimTask: claimTaskAction,
  taskProgress: taskProgressAction,
  taskDone: taskDoneAction,
  taskFailed: taskFailedAction,
  releaseTask: releaseTaskAction,
}

export const ACTION_NAMES = Object.keys(ACTION_REGISTRY)

/**
 * Сверка реестра с каталогом документации (lib/machine-api/catalog.ts).
 *
 * Это два независимых списка: реестр решает, что API умеет, каталог — что видит
 * админ на странице «Удалённый доступ → API». Добавить экшен только в реестр
 * технически можно, и тогда он молча не попадёт в документацию — снаружи это
 * выглядит как отсутствующая возможность. Обратное тоже бывает: экшен
 * переименовали, а карточка осталась описывать несуществующий.
 *
 * Слить списки в один нельзя: каталог импортируется клиентским компонентом, а
 * реестр тянет за собой обработчики и через них `pg`. Поэтому не единый
 * источник, а громкая сверка при загрузке модуля — дешевле, чем ловить
 * расхождение глазами на ревью.
 */
if (process.env.NODE_ENV !== "production") {
  const documented = new Set(MACHINE_API_ACTIONS.map((doc) => doc.action))
  const missing = ACTION_NAMES.filter((name) => !documented.has(name))
  const stale = [...documented].filter((name) => !(name in ACTION_REGISTRY))

  if (missing.length > 0) {
    console.warn(
      `[machine-api] экшены без документации: ${missing.join(", ")} — добавьте карточку в lib/machine-api/catalog.ts`,
    )
  }
  if (stale.length > 0) {
    console.warn(
      `[machine-api] документация без экшенов: ${stale.join(", ")} — карточка в lib/machine-api/catalog.ts описывает то, чего нет в реестре`,
    )
  }
}
