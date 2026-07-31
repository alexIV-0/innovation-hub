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
 * Prefixes that may appear in /api/media keys. Always includes the configured
 * AWS_S3_PREFIX plus legacy names used before the bucket rename, so a wrong
 * env value (e.g. prefix accidentally set to the bucket name) does not 404
 * every historical thumbnail.
 */
export function getAllowedMediaPrefixes(): string[] {
  const configured = getS3Prefix()
  const legacy = ["innohub", "ffworks"]
  return Array.from(new Set([configured, ...legacy]))
}

export function isAllowedMediaObjectKey(key: string): boolean {
  return getAllowedMediaPrefixes().some((prefix) => key.startsWith(`${prefix}/`))
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

const LEGACY_STORAGE_HOST_SUFFIXES = [
  "twcstorage.ru",
  "amazonaws.com",
  "r2.cloudflarestorage.com",
]

function decodeKeyPath(keyPath: string): string {
  return keyPath
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join("/")
}

function isLegacyStorageHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return LEGACY_STORAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}

/**
 * Path-style object URL: https://endpoint/bucket/key…
 * Returns the object key, or null when the path is not bucket/key.
 */
function keyFromPathStyleUrl(
  mediaUrl: URL,
  preferredBucket?: string,
): string | null {
  const segments = mediaUrl.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return null

  const [bucketSegment, ...keySegments] = segments
  if (preferredBucket && bucketSegment !== preferredBucket) {
    // Still accept foreign bucket names from legacy hosts — the key is what
    // we store under /api/media and look up in the *current* bucket.
  }
  void bucketSegment
  const key = decodeKeyPath(keySegments.join("/"))
  return key || null
}

/**
 * Converts stored media URLs to a stable same-origin app path when possible.
 * Fixes absolute localhost / wrong-host `/api/media/...` URLs left in the DB
 * after local uploads, and maps private object-storage URLs back through the
 * app proxy (including older absolute object-storage hosts after a migration).
 */
export function normalizeMediaDisplayUrl(rawUrl: string): string {
  const value = rawUrl.trim()
  if (!value) return value
  if (value.startsWith("/api/media/")) {
    // Mistaken uploads when AWS_S3_PREFIX was set to the bucket name.
    if (value.startsWith("/api/media/ffworks/")) {
      return value.replace("/api/media/ffworks/", "/api/media/innohub/")
    }
    return value
  }

  try {
    const mediaUrl = new URL(value)
    // Absolute app-proxy links (e.g. https://localhost:3000/api/media/...) must
    // become relative so they work on any host (prod included).
    if (mediaUrl.pathname.startsWith("/api/media/")) {
      return `${mediaUrl.pathname}${mediaUrl.search}`
    }

    const endpoint = process.env.AWS_ENDPOINT_URL?.trim().replace(/\/+$/, "")
    const bucket = process.env.AWS_S3_BUCKET?.trim()
    const publicBase = process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL?.trim()

    let matchesConfiguredHost = false
    if (endpoint) {
      try {
        const endpointUrl = new URL(endpoint)
        matchesConfiguredHost =
          endpointUrl.protocol === mediaUrl.protocol &&
          endpointUrl.host === mediaUrl.host
      } catch {
        matchesConfiguredHost = false
      }
    }
    if (publicBase) {
      try {
        const publicUrl = new URL(publicBase)
        if (
          publicUrl.protocol === mediaUrl.protocol &&
          publicUrl.host === mediaUrl.host
        ) {
          matchesConfiguredHost = true
        }
      } catch {
        // ignore malformed public base
      }
    }

    if (!matchesConfiguredHost && !isLegacyStorageHost(mediaUrl.hostname)) {
      return value
    }

    // Prefer path-style /{bucket}/{key}. For CDN bases that already include
    // the bucket, fall back to the whole pathname as the key.
    const pathKey = keyFromPathStyleUrl(mediaUrl, bucket)
    if (pathKey) {
      return appMediaProxyPathForKey(pathKey)
    }

    const rawPathKey = decodeKeyPath(mediaUrl.pathname)
    if (rawPathKey) {
      return appMediaProxyPathForKey(rawPathKey)
    }

    return value
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
