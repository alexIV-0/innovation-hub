import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { requireStorageApi } from "@/lib/storage/auth"
import {
  isMutationError,
  restoreOwnedProject,
} from "@/lib/storage/project-mutations"
import { serializeStorageProjectWithOwner } from "@/lib/storage/project-catalog"

export const runtime = "nodejs"

const schema = z.object({
  projectId: z.string().uuid(),
})

/** POST /api/storage/v1/project-restore — undelete a soft-deleted project. */
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

  const result = await restoreOwnedProject(auth, parsed.data)
  if (result instanceof NextResponse) return result
  if (isMutationError(result)) {
    return NextResponse.json({ message: result.error }, { status: result.status })
  }
  return NextResponse.json({
    project: await serializeStorageProjectWithOwner(result.data),
  })
}
