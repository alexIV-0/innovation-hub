import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { requireAdminApi } from "@/lib/admin-auth"
import { videoCreateSchema } from "@/lib/admin-schemas"
import { createVideo, listVideos } from "@/lib/repositories/videos"

export async function GET(request: NextRequest) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const videos = await listVideos()
  return NextResponse.json(videos)
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminApi(request, "content.manage")
  if (auth instanceof NextResponse) return auth

  const payload = await request.json()
  const parsed = videoCreateSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      { message: "Invalid video payload.", errors: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const video = await createVideo(parsed.data)
  revalidateTag("published-videos", "max")
  return NextResponse.json(video, { status: 201 })
}
