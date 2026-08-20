import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import {
  actorFromAuth,
  requireEditableProjectAccess,
  requireStorageApi,
} from "@/lib/storage/auth"
import { StorageWriteError, writeEnsureFolderPath, writeFolderCreate } from "@/lib/storage/write-path"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().min(1),
  folderPath: z.string().default(""),
  name: z.string().min(1).max(180).optional(),
  /** Full relative path to ensure (a/b/c) — creates missing parents. */
  ensurePath: z.string().min(1).max(1000).optional(),
  eventId: z.string().optional(),
})

/** POST /api/storage/v1/mkdir */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const data = parsed.data
  const access = await requireEditableProjectAccess(auth, data.projectId)
  if (access instanceof NextResponse) return access

  try {
    if (data.ensurePath) {
      const base = data.folderPath.replace(/^\/+|\/+$/g, "")
      const rel = data.ensurePath.replace(/^\/+|\/+$/g, "")
      const full = base ? `${base}/${rel}` : rel
      const result = await writeEnsureFolderPath({
        userId: access.ownerId,
        projectId: access.projectId,
        folderPath: full,
        eventId: data.eventId,
        actor: actorFromAuth(auth),
      })
      return NextResponse.json(
        { folderPath: result.folderPath, fileIds: result.folderIds },
        { status: 201 },
      )
    }

    if (!data.name) {
      return NextResponse.json({ message: "name is required." }, { status: 400 })
    }
    if (data.name.includes("/") || data.name.includes("\\")) {
      return NextResponse.json({ message: "Invalid folder name." }, { status: 400 })
    }
    const file = await writeFolderCreate({
      userId: access.ownerId,
      projectId: access.projectId,
      folderPath: data.folderPath,
      name: data.name,
      eventId: data.eventId,
      actor: actorFromAuth(auth),
    })
    return NextResponse.json({ file, fileIds: [file.id] }, { status: 201 })
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return NextResponse.json({ message: error.message }, { status: error.status })
    }
    const msg = error instanceof Error ? error.message : "Could not create folder."
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { message: "A file or folder with that name already exists." },
        { status: 409 },
      )
    }
    return NextResponse.json({ message: msg }, { status: 500 })
  }
}
