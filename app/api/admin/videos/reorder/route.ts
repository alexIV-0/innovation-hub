import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { reorderSchema } from "@/lib/admin-schemas"
import { reorderVideo } from "@/lib/repositories/videos"

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const payload = await request.json()
  const parsed = reorderSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid reorder payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const result = await reorderVideo(parsed.data.id, parsed.data.direction)
  if (result === "not_found") {
    return NextResponse.json({ message: "Video not found." }, { status: 404 })
  }
  if (result === "boundary") {
    return NextResponse.json({ message: "Already at boundary." }, { status: 400 })
  }

  revalidateTag("published-videos", "max")
  return NextResponse.json({ message: "Reordered." })
}
