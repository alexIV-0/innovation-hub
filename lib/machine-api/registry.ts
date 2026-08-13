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
}

export const ACTION_NAMES = Object.keys(ACTION_REGISTRY)
