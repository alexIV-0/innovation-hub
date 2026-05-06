const DEFAULT_PREFIX = "innohub"

function normalizePrefix(raw: string | undefined): string {
  const trimmed = (raw ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "")
  return trimmed || DEFAULT_PREFIX
}

export function getS3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET
  if (!bucket) throw new Error("AWS_S3_BUCKET is not set")
  return bucket
}

/** Logical "folder" inside the bucket (S3 key prefix, no leading/trailing slashes). */
export function getS3Prefix(): string {
  return normalizePrefix(process.env.AWS_S3_PREFIX)
}

/**
 * Builds a full object key as `{prefix}/{relativePath}`.
 * `relativePath` should be a single segment or safe path under the prefix.
 */
export function buildS3ObjectKey(relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, "").replace(/\.\./g, "_")
  const prefix = getS3Prefix()
  return `${prefix}/${rel}`
}

function joinUrlBase(base: string, key: string): string {
  const b = base.replace(/\/+$/, "")
  const k = key.split("/").map(encodeURIComponent).join("/")
  return `${b}/${k}`
}

export function appMediaProxyPathForKey(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  return `/api/media/${encoded}`
}

/**
 * Converts direct object-storage URLs back to our stable app media route.
 * This keeps old DB records working even when bucket objects are private.
 */
export function normalizeMediaDisplayUrl(rawUrl: string): string {
  const value = rawUrl.trim()
  if (!value) return value
  if (value.startsWith("/api/media/")) return value

  const endpoint = process.env.AWS_ENDPOINT_URL?.trim().replace(/\/+$/, "")
  const bucket = process.env.AWS_S3_BUCKET?.trim()
  if (!endpoint || !bucket) return value

  try {
    const endpointUrl = new URL(endpoint)
    const mediaUrl = new URL(value)
    if (
      endpointUrl.protocol !== mediaUrl.protocol ||
      endpointUrl.host !== mediaUrl.host
    ) {
      return value
    }

    const prefix = `/${bucket}/`
    if (!mediaUrl.pathname.startsWith(prefix)) return value

    const keyPath = mediaUrl.pathname.slice(prefix.length)
    const key = keyPath
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment)
        } catch {
          return segment
        }
      })
      .join("/")
    if (!key) return value

    return appMediaProxyPathForKey(key)
  } catch {
    return value
  }
}

/**
 * Public URL for an object when you serve or proxy the bucket at a fixed HTTPS base.
 * Set `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` (no trailing slash), e.g. CDN or static website endpoint.
 */
export function publicObjectUrlForKey(key: string): string | null {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL?.trim()
  if (!base) return null
  return joinUrlBase(base, key)
}
