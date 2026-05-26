import { NextResponse, type NextRequest } from "next/server"
import { requireUserApi } from "@/lib/admin-auth"
import {
  AsanaError,
  attachExternalUrlToTask,
  createFeatureSuggestionTask,
} from "@/lib/asana"
import { resolveExternalAttachmentUrl } from "@/lib/attachment-public-url"
import {
  buildFeatureSuggestionNotes,
  featureSuggestionSchema,
  type FeatureSuggestionAttachment,
} from "@/lib/feature-suggestion-schemas"
import { checkRateLimit, getClientIp } from "@/lib/rate-limit"

export const runtime = "nodejs"

const RATE_LIMIT = 3
const RATE_WINDOW_MS = 10 * 60 * 1000

function taskTitle(name: string): string {
  const trimmed = name.trim()
  const short =
    trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}…` : trimmed
  return `Feature suggestion: ${short}`
}

export async function POST(request: NextRequest) {
  const auth = await requireUserApi(request)
  if (auth instanceof NextResponse) return auth

  const ip = getClientIp(request)
  const rate = checkRateLimit(
    `feature-suggestion:${ip}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  )
  if (!rate.allowed) {
    return NextResponse.json(
      {
        message: `Too many submissions. Try again in ${rate.retryAfterSec} seconds.`,
      },
      { status: 429 },
    )
  }

  const payload = await request.json().catch(() => null)
  const parsed = featureSuggestionSchema.safeParse(payload)
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

  const {
    name,
    email,
    projectName,
    referenceUrl,
    monthlyVolume,
    description,
    automation,
    attachments,
  } = parsed.data

  let attachmentsForAsana: FeatureSuggestionAttachment[]
  try {
    attachmentsForAsana = await Promise.all(
      attachments.map(async (file) => ({
        ...file,
        url: await resolveExternalAttachmentUrl(file.key),
      })),
    )
  } catch (urlError) {
    console.error("[api/feature-suggestions] attachment URL resolve", urlError)
    return NextResponse.json(
      { message: "Could not prepare attachment links. Please try again." },
      { status: 502 },
    )
  }

  const notes = buildFeatureSuggestionNotes({
    name,
    email,
    projectName,
    referenceUrl,
    monthlyVolume,
    description,
    automation,
    attachments: attachmentsForAsana,
  })

  try {
    const task = await createFeatureSuggestionTask({
      name: taskTitle(name),
      notes,
    })

    for (const file of attachmentsForAsana) {
      try {
        await attachExternalUrlToTask(task.gid, {
          url: file.url,
          name: file.name,
        })
      } catch (attachError) {
        console.error(
          "[api/feature-suggestions] attachment failed",
          task.gid,
          file.key,
          attachError,
        )
      }
    }

    return NextResponse.json({
      taskGid: task.gid,
      url: task.permalink_url ?? null,
      message: "Thank you! Your suggestion was submitted.",
    })
  } catch (e) {
    if (e instanceof AsanaError) {
      console.error("[api/feature-suggestions] Asana error", e.status, e.message)
      const status = e.status >= 400 && e.status < 600 ? e.status : 502
      return NextResponse.json(
        {
          message:
            status === 500
              ? "Submission service is not configured. Please try again later."
              : "Could not create the task in Asana. Please try again later.",
        },
        { status: status >= 500 ? 502 : status },
      )
    }
    console.error("[api/feature-suggestions]", e)
    return NextResponse.json(
      { message: "Unexpected error. Please try again later." },
      { status: 500 },
    )
  }
}
