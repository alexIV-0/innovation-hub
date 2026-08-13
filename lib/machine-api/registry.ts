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
  projectRenameAction,
  projectStateAction,
  projectsAction,
} from "@/lib/machine-api/actions/storage-projects"
import {
  deleteObjectAction,
  mkdirAction,
  notifyAction,
  presignAction,
  putSidecarAction,
  reindexAction,
  renameAction,
} from "@/lib/machine-api/actions/storage-write"

export const ACTION_REGISTRY: Record<string, MachineActionHandler> = {
  me: meAction,
  heartbeat: heartbeatAction,
  capabilities: capabilitiesAction,
  projects: projectsAction,
  createProject: createProjectAction,
  projectRename: projectRenameAction,
  projectState: projectStateAction,
  tree: treeAction,
  delta: deltaAction,
  presign: presignAction,
  notify: notifyAction,
  mkdir: mkdirAction,
  rename: renameAction,
  deleteObject: deleteObjectAction,
  reindex: reindexAction,
  getSidecar: getSidecarAction,
  putSidecar: putSidecarAction,
}

export const ACTION_NAMES = Object.keys(ACTION_REGISTRY)
