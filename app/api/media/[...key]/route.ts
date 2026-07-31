import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { findFileByS3Key } from "@/lib/repositories/project-files"
import { findUserById } from "@/lib/repositories/users"
import { getS3Bucket, getS3Prefix } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"

export const runtime = "nodejs"

type Params = {
  params: Promise<{ key?: string[] }>
}

const SIGNED_URL_TTL_SECONDS = 3600

function decodeKey(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  const parts: string[] = []
  for (const segment of segments) {
    if (!segment) continue
    if (segment.includes("..")) return null
    try {
      const decoded = decodeURIComponent(segment)
      if (decoded.includes("..") || decoded.includes("/")) return null
      parts.push(decoded)
    } catch {
      return null
    }
  }
  const key = parts.join("/")
  return key ? key : null
}

async function authorizeProjectKey(
  request: NextRequest,
  key: string,
): Promise<NextResponse | null> {
  const prefix = `${getS3Prefix()}/projects/`
  if (!key.startsWith(prefix)) return null // not a project key — public OK

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }
  const session = await verifySessionToken(token)
  if (!session?.userId) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 })
  }

  const user = await findUserById(session.userId)
  if (!user || !user.isActive) {
    return NextResponse.json({ message: "Forbidden." }, { status: 403 })
  }

  // Admins can open any project media.
  if (user.role === "ADMIN") return null

  const file = await findFileByS3Key(key)
  if (!file || file.ownerId !== user.id) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }
  return null
}

export async function GET(request: NextRequest, { params }: Params) {
  const key = decodeKey((await params).key)
  if (!key) {
    return NextResponse.json({ message: "Invalid media key." }, { status: 400 })
  }

  const expectedPrefix = `${getS3Prefix()}/`
  if (!key.startsWith(expectedPrefix)) {
    return NextResponse.json({ message: "Not found." }, { status: 404 })
  }

  const denied = await authorizeProjectKey(request, key)
  if (denied) return denied

  try {
    const bucket = getS3Bucket()
    const client = getS3Client()
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
    const signedGetUrl = await getSignedUrl(client, command, {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    })
    const response = NextResponse.redirect(signedGetUrl, { status: 307 })
    response.headers.set(
      "Cache-Control",
      `private, max-age=${Math.floor(SIGNED_URL_TTL_SECONDS / 2)}, must-revalidate`,
    )
    return response
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unable to open media."
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}

export async function HEAD(request: NextRequest, context: Params) {
  return GET(request, context)
}
