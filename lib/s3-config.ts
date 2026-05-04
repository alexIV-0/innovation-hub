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

/**
 * Public URL for an object when you serve or proxy the bucket at a fixed HTTPS base.
 * Set `NEXT_PUBLIC_S3_PUBLIC_BASE_URL` (no trailing slash), e.g. CDN or static website endpoint.
 */
export function publicObjectUrlForKey(key: string): string | null {
  const base = process.env.NEXT_PUBLIC_S3_PUBLIC_BASE_URL?.trim()
  if (!base) return null
  return joinUrlBase(base, key)
}
