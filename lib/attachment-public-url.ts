import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  appMediaProxyPathForKey,
  getS3Bucket,
  publicObjectUrlForKey,
} from "@/lib/s3-config"
import { getS3Client } from "@/lib/s3-client"

const DEFAULT_PRESIGN_SEC = 7 * 24 * 60 * 60

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** HTTPS origin for links sent to third parties (Asana, email). Not localhost. */
export function getAppPublicOrigin(): string | null {
  for (const raw of [
    process.env.APP_PUBLIC_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ]) {
    const trimmed = raw?.trim().replace(/\/+$/, "")
    if (!trimmed) continue
    const origin = trimmed.startsWith("http")
      ? trimmed
      : `https://${trimmed}`
    if (!isLocalOrigin(origin)) return origin
  }

  const vercel = process.env.VERCEL_URL?.trim().replace(/\/+$/, "")
  if (vercel) return `https://${vercel}`

  return null
}

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]"
    )
  } catch {
    return true
  }
}

/** Same-origin path for browser preview during upload (any dev port). */
export function relativeMediaUrlForKey(key: string): string {
  return appMediaProxyPathForKey(key)
}

/**
 * URL that external services (Asana) can fetch: CDN, public app /api/media, or
 * a long-lived presigned GET URL when developing on localhost.
 */
export async function resolveExternalAttachmentUrl(key: string): Promise<string> {
  const cdn = publicObjectUrlForKey(key)
  if (cdn) return cdn

  const origin = getAppPublicOrigin()
  if (origin) {
    return `${origin}${appMediaProxyPathForKey(key)}`
  }

  const ttl = readPositiveInt("FEATURE_SUGGESTION_PRESIGN_SEC", DEFAULT_PRESIGN_SEC)
  const client = getS3Client()
  const bucket = getS3Bucket()
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttl },
  )
}
