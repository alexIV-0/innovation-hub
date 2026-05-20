type Bucket = {
  count: number
  resetAt: number
}

const store = new Map<string, Bucket>()

/**
 * Simple in-memory rate limiter (per server instance).
 * Good enough for MVP; replace with Redis/KV if traffic grows.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now()
  const existing = store.get(key)

  if (!existing || now >= existing.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true }
  }

  if (existing.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    return { allowed: false, retryAfterSec }
  }

  existing.count += 1
  return { allowed: true }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp
  return "unknown"
}
