import { NextResponse } from "next/server"
import { z } from "zod"
import { apiError, apiOk } from "@/lib/machine-api/http"
import { defineAction } from "@/lib/machine-api/types"
import { requireProjectAccess } from "@/lib/storage/auth"
import { STORAGE_CAPABILITIES } from "@/lib/storage/capabilities"
import { getDelta, getLatestCursor } from "@/lib/storage/changes"
import { serializeStorageChange } from "@/lib/storage/delta-format"
import { loadDisplayContext, buildDisplayPath } from "@/lib/storage/display-path"
import { loadStorageTree } from "@/lib/storage/tree"
import {
  getObjectText,
  projectDescriptionKey,
  projectFolderStateKey,
  projectOptionsKey,
} from "@/lib/project-storage"

export const capabilitiesAction = defineAction(z.object({}), async () =>
  apiOk(STORAGE_CAPABILITIES),
)

export const treeAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    prefix: z.string().optional().default(""),
  }),
  async (auth, props) => {
    const access = await requireProjectAccess(auth, props.projectId)
    if (access instanceof NextResponse) return access

    const [entries, cursor, display] = await Promise.all([
      loadStorageTree({ projectId: access.projectId, prefix: props.prefix }),
      getLatestCursor(access.projectId),
      loadDisplayContext(access.projectId),
    ])
    return apiOk({
      entries: display
        ? entries.map((e) => ({
            ...e,
            displayPath: buildDisplayPath(display, e.folderPath, e.name),
          }))
        : entries,
      cursor,
    })
  },
)

export const deltaAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    since: z.number().int().nonnegative().optional().default(0),
  }),
  async (auth, props) => {
    const access = await requireProjectAccess(auth, props.projectId)
    if (access instanceof NextResponse) return access

    const [delta, display] = await Promise.all([
      getDelta({
        projectId: access.projectId,
        since: props.since,
      }),
      loadDisplayContext(access.projectId),
    ])
    return apiOk({
      changes: delta.changes.map((c) => serializeStorageChange(c, display)),
      cursor: delta.cursor,
      truncated: delta.truncated,
    })
  },
)

export const getSidecarAction = defineAction(
  z.object({
    projectId: z.string().min(1),
    // description — options/description.md, развёрнутое описание проекта.
    name: z.enum(["folder-state", "options", "description"]),
  }),
  async (auth, props) => {
    const access = await requireProjectAccess(auth, props.projectId)
    if (access instanceof NextResponse) return access

    const key =
      props.name === "folder-state"
        ? projectFolderStateKey(access.storageOwnerId, access.projectId)
        : props.name === "description"
          ? projectDescriptionKey(access.storageOwnerId, access.projectId)
          : projectOptionsKey(access.storageOwnerId, access.projectId)

    const text = await getObjectText(key)
    if (text == null) return apiError("Not found.", 404)
    return apiOk({ key, body: text })
  },
)
