import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { reorderSchema } from "@/lib/admin-schemas"
import { reorderIdea } from "@/lib/repositories/ideas"

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json()
  const parsed = reorderSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid reorder payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await reorderIdea(parsed.data.id, parsed.data.direction)
  if (result === "not_found") {
    return NextResponse.json({ message: "Idea not found." }, { status: 404 })
  }
  if (result === "boundary") {
    return NextResponse.json({ message: "Already at boundary." }, { status: 400 })
  }

  return NextResponse.json({ message: "Reordered." })
}
