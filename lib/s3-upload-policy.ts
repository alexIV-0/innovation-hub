const ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
])

export function isAllowedUploadContentType(contentType: string): boolean {
  return ALLOWED.has(contentType.trim().toLowerCase())
}

/** Resolve MIME from browser File.type or from file extension (Windows often omits type). */
export function resolveUploadContentType(file: {
  name: string
  type: string
}): string | null {
  const t = file.type.trim().toLowerCase()
  if (t && ALLOWED.has(t)) return t

  const lower = file.name.toLowerCase()
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".mp4")) return "video/mp4"
  if (lower.endsWith(".webm")) return "video/webm"
  if (lower.endsWith(".mov")) return "video/quicktime"
  return null
}

export function safeBaseFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? "file"
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]/gu, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  return cleaned.slice(0, 180) || "file"
}

const DEFAULT_MAX_BYTES = 250 * 1024 * 1024

export function getMaxUploadBytes(): number {
  const raw = process.env.ADMIN_UPLOAD_MAX_BYTES
  if (!raw) return DEFAULT_MAX_BYTES
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES
}
