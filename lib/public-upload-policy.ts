export {
  isAllowedUploadContentType,
  resolveUploadContentType,
  safeBaseFileName,
} from "@/lib/s3-upload-policy"

const DEFAULT_MAX_BYTES = 25 * 1024 * 1024
const DEFAULT_MAX_FILES = 5

export function getPublicUploadMaxBytes(): number {
  const raw =
    process.env.FEATURE_SUGGESTION_UPLOAD_MAX_BYTES ??
    process.env.PUBLIC_UPLOAD_MAX_BYTES
  if (!raw) return DEFAULT_MAX_BYTES
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES
}

export function getPublicUploadMaxFiles(): number {
  const raw = process.env.FEATURE_SUGGESTION_MAX_FILES
  if (!raw) return DEFAULT_MAX_FILES
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : DEFAULT_MAX_FILES
}
