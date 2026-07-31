/**
 * Allowed MIME types for workspace (project) uploads — broader than admin
 * content uploads so users can drop text, audio, JSON, etc.
 */
const PROJECT_ALLOWED = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/webm",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
])

export function isAllowedProjectContentType(contentType: string): boolean {
  return PROJECT_ALLOWED.has(contentType.trim().toLowerCase())
}

export function resolveProjectContentType(file: {
  name: string
  type: string
}): string | null {
  const t = file.type.trim().toLowerCase()
  if (t && PROJECT_ALLOWED.has(t)) return t

  const lower = file.name.toLowerCase()
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".webp")) return "image/webp"
  if (lower.endsWith(".gif")) return "image/gif"
  if (lower.endsWith(".mp4")) return "video/mp4"
  if (lower.endsWith(".webm")) return "video/webm"
  if (lower.endsWith(".mov")) return "video/quicktime"
  if (lower.endsWith(".mp3")) return "audio/mpeg"
  if (lower.endsWith(".wav")) return "audio/wav"
  if (lower.endsWith(".ogg")) return "audio/ogg"
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain"
  if (lower.endsWith(".csv")) return "text/csv"
  if (lower.endsWith(".json")) return "application/json"
  if (lower.endsWith(".pdf")) return "application/pdf"
  if (lower.endsWith(".zip")) return "application/zip"
  return "application/octet-stream"
}
