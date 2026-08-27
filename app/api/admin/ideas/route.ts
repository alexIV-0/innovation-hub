import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { ideaCreateSchema } from "@/lib/admin-schemas"
import { createIdea, listIdeas } from "@/lib/repositories/ideas"

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const ideas = await listIdeas()
  return NextResponse.json(ideas)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const payload = await request.json()
  const parsed = ideaCreateSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid idea payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const idea = await createIdea(parsed.data)
  return NextResponse.json(idea, { status: 201 })
}
