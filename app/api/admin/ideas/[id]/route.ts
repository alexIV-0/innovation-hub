import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { ideaUpdateSchema } from "@/lib/admin-schemas"
import { deleteIdea, updateIdea } from "@/lib/repositories/ideas"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const payload = await request.json()
  const parsed = ideaUpdateSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid idea payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const idea = await updateIdea(id, parsed.data)
  if (!idea) {
    return NextResponse.json({ message: "Idea not found." }, { status: 404 })
  }

  return NextResponse.json(idea)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  await deleteIdea(id)
  return NextResponse.json({ message: "Idea deleted." })
}
