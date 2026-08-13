import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { updateProjectSchema } from "@/lib/project-schemas"
import {
  findOwnedProject,
  updateProject,
} from "@/lib/repositories/projects"
import { syncProjectMeta } from "@/lib/storage/project-catalog"
import {
  isMutationError,
  softDeleteOwnedProject,
} from "@/lib/storage/project-mutations"
import type { StorageApiAuth } from "@/lib/storage/auth"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const project = await findOwnedProject(id, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return NextResponse.json({ project })
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ message: "Invalid JSON." }, { status: 400 })
  }

  const parsed = updateProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { message: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 },
    )
  }

  const project = await updateProject(id, auth.userId, parsed.data)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (
    parsed.data.name !== undefined ||
    parsed.data.description !== undefined ||
    parsed.data.isArchived !== undefined
  ) {
    await syncProjectMeta(project)
  }
  return NextResponse.json({ project })
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  const storageAuth: StorageApiAuth = {
    userId: auth.userId,
    email: auth.email,
    role: auth.role,
    machineTokenId: null,
    computerId: null,
    scopedProjectId: null,
  }
  const result = await softDeleteOwnedProject(storageAuth, { projectId: id })
  if (result instanceof NextResponse) return result
  if (isMutationError(result)) {
    return NextResponse.json({ message: result.error }, { status: result.status })
  }
  return NextResponse.json(result.data)
}
