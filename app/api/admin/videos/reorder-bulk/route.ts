import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { reorderBulkSchema } from "@/lib/admin-schemas"
import { reorderVideosBulk } from "@/lib/repositories/videos"

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request)
  if (auth instanceof NextResponse) return auth

  const payload = await request.json().catch(() => null)
  const parsed = reorderBulkSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  try {
    const videos = await reorderVideosBulk(parsed.data.ids)
    revalidateTag("published-videos", "max")
    return NextResponse.json({ videos })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "INVALID_REORDER_LENGTH") {
        return NextResponse.json(
          { message: "Reorder list must include every video." },
          { status: 400 },
        )
      }
      if (error.message === "INVALID_REORDER_IDS") {
        return NextResponse.json(
          { message: "One or more video ids are invalid." },
          { status: 400 },
        )
      }
    }
    console.error("[api/admin/videos/reorder-bulk]", error)
    return NextResponse.json(
      { message: "Could not save order." },
      { status: 500 },
    )
  }
}
