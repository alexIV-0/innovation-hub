import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import { createAsanaTask } from "@/lib/asana"
import { publicVideoPageUrl } from "@/lib/public-site-url"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"
import { findPublishedVideoById } from "@/lib/repositories/videos"
import {
  buildVideoOrderNotes,
  videoOrderSchema,
} from "@/lib/video-order-schemas"

export const runtime = "nodejs"

const RATE_LIMIT = 3
const RATE_WINDOW_MS = 10 * 60 * 1000

function taskTitle(videoTitle: string, projectName: string): string {
  const shortProject =
    projectName.length > 40
      ? `${projectName.slice(0, 37).trimEnd()}…`
      : projectName
  const shortVideo =
    videoTitle.length > 40 ? `${videoTitle.slice(0, 37).trimEnd()}…` : videoTitle
  return `Video order: ${shortProject} (ref: ${shortVideo})`
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const ip = getClientIp(request)
  const rate = checkRateLimit(`video-order:${ip}`, RATE_LIMIT, RATE_WINDOW_MS)
  if (!rate.allowed) {
    return NextResponse.json(
      {
        message: `Too many submissions. Try again in ${rate.retryAfterSec} seconds.`,
      },
      { status: 429 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = videoOrderSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        message: "Please check the form and try again.",
        errors: parsed.error.flatten(),
      },
      { status: 400 },
    )
  }

  if (parsed.data.website?.trim()) {
    return NextResponse.json({ message: "Invalid submission." }, { status: 400 })
  }

  const video = await findPublishedVideoById(parsed.data.videoId)
  if (!video) {
    return NextResponse.json({ message: "Video not found." }, { status: 404 })
  }

  const notes = buildVideoOrderNotes({
    videoTitle: video.title,
    videoUrl: publicVideoPageUrl(video.id),
    name: parsed.data.name,
    email: parsed.data.email,
    projectName: parsed.data.projectName,
    monthlyVolume: parsed.data.monthlyVolume,
    description: parsed.data.description,
  })

  try {
    const task = await createAsanaTask({
      name: taskTitle(video.title, parsed.data.projectName),
      notes,
      projectGid: process.env.ASANA_VIDEO_ORDERS_PROJECT_GID?.trim(),
      sectionGid: process.env.ASANA_VIDEO_ORDERS_SECTION_GID?.trim(),
    })

    return NextResponse.json({
      taskGid: task.gid,
      url: task.permalink_url ?? null,
      message: "Thank you! Your request was submitted.",
    })
  } catch (error) {
    console.error("[api/video-orders]", error)
    return NextResponse.json(
      { message: "Could not submit your request. Please try again later." },
      { status: 502 },
    )
  }
}
