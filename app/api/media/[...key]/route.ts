import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { NextResponse, type NextRequest } from "next/server"
import { getS3Bucket } from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"

export const runtime = "nodejs"

type Params = {
  params: Promise<{ key?: string[] }>
}

function decodeKey(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return null
  const parts: string[] = []
  for (const segment of segments) {
    if (!segment) continue
    try {
      parts.push(decodeURIComponent(segment))
    } catch {
      return null
    }
  }
  const key = parts.join("/")
  return key ? key : null
}

export async function GET(_request: NextRequest, { params }: Params) {
  const key = decodeKey((await params).key)
  if (!key) {
    return NextResponse.json({ message: "Invalid media key." }, { status: 400 })
  }

  try {
    const bucket = getS3Bucket()
    const client = getS3Client()
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
    const signedGetUrl = await getSignedUrl(client, command, { expiresIn: 3600 })
    return NextResponse.redirect(signedGetUrl, { status: 307 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unable to open media."
    return NextResponse.json({ message: msg }, { status: 502 })
  }
}

export async function HEAD(request: NextRequest, context: Params) {
  return GET(request, context)
}
