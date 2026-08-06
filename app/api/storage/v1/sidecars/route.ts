import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  requireOwnedProjectAccess,
  requireProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import {
  getObjectText,
  projectFolderStateKey,
  projectOptionsKey,
  ProjectStorageError,
  setProjectAutomationEnabled,
  siteUpdatedBy,
  updateProjectExposedOptions,
} from "@/lib/project-storage"
import {
  journalStorageEvent,
  StorageWriteError,
  writeSidecarPut,
} from "@/lib/storage/write-path"
import { updateProject } from "@/lib/repositories/projects"

export const runtime = "nodejs"

const putSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("folder-state"),
    projectId: z.string().min(1),
    enabled: z.boolean(),
  }),
  z.object({
    kind: z.literal("options"),
    projectId: z.string().min(1),
    changes: z.array(
      z.object({
        path: z.array(z.string()),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    ),
  }),
  z.object({
    kind: z.literal("raw"),
    projectId: z.string().min(1),
    sidecar: z.enum(["folder-state", "options"]),
    body: z.string().min(1),
    ifMatch: z.string().optional(),
  }),
])

/** GET /api/storage/v1/sidecars?projectId=&name=folder-state|options */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const projectId = request.nextUrl.searchParams.get("projectId")?.trim()
  const name = request.nextUrl.searchParams.get("name")?.trim()
  if (!projectId || !name) {
    return NextResponse.json(
      { message: "projectId and name are required." },
      { status: 400 },
    )
  }

  const access = await requireProjectAccess(auth, projectId)
  if (access instanceof NextResponse) return access

  const key =
    name === "folder-state"
      ? projectFolderStateKey(access.projectId)
      : name === "options"
        ? projectOptionsKey(access.projectId)
        : null
  if (!key) {
    return NextResponse.json({ message: "Unknown sidecar." }, { status: 400 })
  }

  const text = await getObjectText(key)
  if (text == null) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return NextResponse.json({ key, body: text })
}

/** PUT /api/storage/v1/sidecars */
export async function PUT(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const data = parsed.data
  const access = await requireOwnedProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    if (data.kind === "folder-state") {
      const folderState = await setProjectAutomationEnabled({
        projectId: access.projectId,
        enabled: data.enabled,
        updatedBy: siteUpdatedBy(auth.email),
      })
      const key = projectFolderStateKey(access.projectId)
      await journalStorageEvent({
        projectId: access.projectId,
        key,
        op: "put",
        payload: { name: "folderState.json", folderPath: "options" },
      })
      await updateProject(access.projectId, auth.userId, {
        isActive: folderState.enabled,
      }).catch(() => undefined)
      return NextResponse.json({ folderState })
    }

    if (data.kind === "options") {
      const result = await updateProjectExposedOptions({
        projectId: access.projectId,
        changes: data.changes,
      })
      await journalStorageEvent({
        projectId: access.projectId,
        key: projectOptionsKey(access.projectId),
        op: "put",
        payload: { name: "options.json", folderPath: "options" },
      })
      return NextResponse.json({ options: result })
    }

    const key =
      data.sidecar === "folder-state"
        ? projectFolderStateKey(access.projectId)
        : projectOptionsKey(access.projectId)
    const { etag } = await writeSidecarPut({
      projectId: access.projectId,
      key,
      body: data.body,
      ifMatch: data.ifMatch,
    })
    return NextResponse.json({ ok: true, etag })
  } catch (error) {
    if (
      error instanceof ProjectStorageError ||
      error instanceof StorageWriteError
    ) {
      return NextResponse.json({ message: error.message }, { status: 409 })
    }
    console.error("[storage] sidecar put failed", error)
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Update failed." },
      { status: 503 },
    )
  }
}
