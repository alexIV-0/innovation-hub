import { createHash } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { z } from "zod"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { findUserById } from "@/lib/repositories/users"
import { insertVisitorEvent } from "@/lib/repositories/visitor-events"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const bodySchema = z.object({
  path: z.string().min(1).max(2048),
  query: z.string().max(2048).optional(),
  referer: z.string().max(2048).optional(),
})

/**
 * Routes we never want polluting the Visitors dashboard — internal Next.js
 * traffic, API calls, and the admin surface itself (otherwise every refresh
 * of /admin/visitors becomes a "visit" we then immediately display).
 */
const PATH_BLOCKLIST = [/^\/api\//, /^\/_next\//, /^\/admin/]

function shouldSkip(path: string): boolean {
  if (!path.startsWith("/")) return true
  return PATH_BLOCKLIST.some((re) => re.test(path))
}

function readClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) {
    const first = xff.split(",")[0]?.trim()
    if (first) return first
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    ""
  )
}

function makeFingerprint(parts: { ip: string; ua: string; lang: string }) {
  const raw = `${parts.ip}|${parts.ua}|${parts.lang}`
  return createHash("sha256").update(raw).digest("hex").slice(0, 16)
}

export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const parsed = bodySchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json({ ok: true })
  }

  if (shouldSkip(parsed.data.path)) {
    return NextResponse.json({ ok: true })
  }

  const ip = readClientIp(request)
  const ua = request.headers.get("user-agent") ?? ""
  const lang = request.headers.get("accept-language") ?? ""
  const fingerprint = makeFingerprint({ ip, ua, lang })

  let userId: string | null = null
  let userEmail: string | null = null
  let userFullName: string | null = null

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (token) {
    const session = await verifySessionToken(token)
    if (session?.userId) {
      userId = session.userId
      userEmail = session.email ?? null
      try {
        const profile = await findUserById(session.userId)
        if (profile) {
          userEmail = profile.email
          userFullName = profile.fullName
        }
      } catch {
        // Profile lookup is best-effort; tracking must not fail because of it.
      }
    }
  }

  try {
    await insertVisitorEvent({
      path: parsed.data.path,
      queryString: parsed.data.query ?? "",
      method: "GET",
      userId,
      userEmail,
      userFullName,
      fingerprint,
      userAgent: ua,
      ip,
      referer: parsed.data.referer ?? request.headers.get("referer") ?? "",
      language: lang,
    })
  } catch (error) {
    console.error("[visitor-track]", error)
  }

  return NextResponse.json({ ok: true })
}
