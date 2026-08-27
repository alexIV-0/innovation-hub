import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { videoUpdateSchema } from "@/lib/admin-schemas"
import { deleteVideo, updateVideo } from "@/lib/repositories/videos"

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  const payload = await request.json()
  const parsed = videoUpdateSchema.safeParse(payload)

  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid video payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const video = await updateVideo(id, parsed.data)
  if (!video) {
    return NextResponse.json({ message: "Video not found." }, { status: 404 })
  }

  revalidateTag("published-videos", "max")
  return NextResponse.json(video)
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  await deleteVideo(id)
  revalidateTag("published-videos", "max")
  return NextResponse.json({ message: "Video deleted." })
}
