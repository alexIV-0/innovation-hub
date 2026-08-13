import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { createProjectSchema } from "@/lib/project-schemas"
import { requireStorageApi } from "@/lib/storage/auth"
import {
  loadStorageProjectCatalog,
  serializeStorageProjectWithOwner,
} from "@/lib/storage/project-catalog"
import {
  createOwnedProject,
  isMutationError,
  softDeleteOwnedProject,
} from "@/lib/storage/project-mutations"

export const runtime = "nodejs"

const createSchema = createProjectSchema.extend({
  clientId: z.string().uuid().nullable().optional(),
})

const deleteSchema = z.object({
  projectId: z.string().uuid(),
})

/**
 * GET /api/storage/v1/projects
 * Machine-token-friendly project + client catalog.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  const catalog = await loadStorageProjectCatalog(auth)
  if ("error" in catalog) {
    return NextResponse.json({ message: catalog.error }, { status: catalog.status })
  }
  return NextResponse.json(catalog)
}

/**
 * POST /api/storage/v1/projects
 * Create a project under the token owner. Scoped tokens cannot create.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const result = await createOwnedProject(auth, parsed.data)
  if (isMutationError(result)) {
    return NextResponse.json({ message: result.error }, { status: result.status })
  }
  return NextResponse.json(
    { project: await serializeStorageProjectWithOwner(result.data) },
    { status: 201 },
  )
}

/**
 * DELETE /api/storage/v1/projects
 * Soft-delete a project into trash (30 days). Does not wipe R2 immediately.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireStorageApi(request)
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = deleteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const result = await softDeleteOwnedProject(auth, parsed.data)
  if (result instanceof NextResponse) return result
  if (isMutationError(result)) {
    return NextResponse.json({ message: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
