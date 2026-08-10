import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { findFileByS3Key } from "@/lib/repositories/project-files"
import { findUserById } from "@/lib/repositories/users"
import { getS3Bucket, isAllowedMediaObjectKey } from "@/lib/s3-config"
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
    // Reject path-traversal attempts pre-decode and post-decode.
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
  const [namespace, keyUserId, keyProjectId] = key.split("/")
  const isCurrentProjectKey =
    namespace === "projects" &&
    Boolean(keyUserId && keyProjectId) &&
    /^[0-9a-f-]{36}$/i.test(keyUserId) &&
    /^[0-9a-f-]{36}$/i.test(keyProjectId)
  const isLegacyProjectKey =
    key.startsWith("innohub/projects/") || key.startsWith("ffworks/projects/")
  if (!isCurrentProjectKey && !isLegacyProjectKey) return null

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

  if (isCurrentProjectKey && keyUserId === user.id) return null

  // During migration, legacy object keys still need a DB ownership check.
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

  // Hard-scope the proxy to objects under known app prefixes. Without this,
  // any caller could mint a signed URL for any object in the bucket — including
  // siblings owned by other tenants/apps sharing the same bucket.
  if (!isAllowedMediaObjectKey(key)) {
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

    // ?raw=1: stream the object body instead of redirecting. The next/image
    // optimizer can't follow the 307 to the presigned URL, so thumbnails go
    // through this branch (the optimizer caches the result, so each image is
    // proxied rarely). Videos keep using the redirect for range requests.
    if (request.nextUrl.searchParams.has("raw")) {
      const object = await client.send(command)
      const body = object.Body?.transformToWebStream()
      if (!body) {
        return NextResponse.json({ message: "Not found." }, { status: 404 })
      }
      return new Response(body as unknown as ReadableStream, {
        headers: {
          "Content-Type": object.ContentType ?? "application/octet-stream",
          ...(object.ContentLength
            ? { "Content-Length": String(object.ContentLength) }
            : {}),
          "Cache-Control": "public, max-age=86400",
        },
      })
    }

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
