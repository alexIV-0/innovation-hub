"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ImageIcon, Loader2, RotateCcw, UploadCloud, Video, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type DropzoneKind = "image" | "video"

const ACCEPTS: Record<DropzoneKind, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime,.mov",
}

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])
const ALLOWED_VIDEO_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
])

function inferMime(file: File, kind: DropzoneKind): string | null {
  const set = kind === "image" ? ALLOWED_IMAGE_MIME : ALLOWED_VIDEO_MIME
  if (set.has(file.type)) return file.type
  const lower = file.name.toLowerCase()
  if (kind === "image") {
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
    if (lower.endsWith(".png")) return "image/png"
    if (lower.endsWith(".webp")) return "image/webp"
    if (lower.endsWith(".gif")) return "image/gif"
  } else {
    if (lower.endsWith(".mp4")) return "video/mp4"
    if (lower.endsWith(".webm")) return "video/webm"
    if (lower.endsWith(".mov")) return "video/quicktime"
  }
  return null
}

type PresignResponse = {
  uploadUrl: string
  publicUrl: string | null
  method: "PUT"
  contentType: string
  key: string
}

async function requestPresign(file: File, contentType: string) {
  const response = await fetch("/api/admin/upload/presign", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, contentType }),
  })

  const payload = (await response.json().catch(() => null)) as
    | (PresignResponse & { message?: string })
    | { message?: string }
    | null

  if (!response.ok || !payload || !("uploadUrl" in payload)) {
    const msg =
      payload && typeof payload.message === "string"
        ? payload.message
        : `Could not prepare upload (HTTP ${response.status}).`
    throw new Error(msg)
  }

  if (!payload.publicUrl) {
    throw new Error(
      "Server did not return a public URL for the uploaded object.",
    )
  }

  return payload as PresignResponse & { publicUrl: string }
}

/**
 * PUTs `file` directly to S3 at `uploadUrl` (presigned), reporting upload
 * progress. Resolves on 2xx, rejects on abort/network/non-2xx.
 */
function putToS3({
  file,
  uploadUrl,
  contentType,
  onProgress,
  signal,
}: {
  file: File
  uploadUrl: string
  contentType: string
  onProgress: (loaded: number, total: number) => void
  signal: AbortSignal
}): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open("PUT", uploadUrl, true)
    xhr.setRequestHeader("Content-Type", contentType)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }

    /**
     * Try to extract a useful error message from S3's XML body. Storage
     * providers return things like:
     *   <Error><Code>SignatureDoesNotMatch</Code><Message>...</Message>...
     */
    const extractS3Error = (raw: string): string => {
      if (!raw) return ""
      const code = raw.match(/<Code>([^<]+)<\/Code>/i)?.[1]
      const message = raw.match(/<Message>([^<]+)<\/Message>/i)?.[1]
      if (code || message) {
        return [code, message].filter(Boolean).join(": ")
      }
      return raw.slice(0, 240)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      const detail = extractS3Error(xhr.responseText ?? "")
      reject(
        new Error(
          `Storage rejected the upload (HTTP ${xhr.status})${
            detail ? ` — ${detail}` : ""
          }.`,
        ),
      )
    }
    xhr.onerror = () => {
      // status is 0 here. If responseText is empty too, the response was
      // blocked before our JS could read it (typical CORS-on-error case
      // with S3-compatible providers that omit CORS headers on 4xx).
      const detail = extractS3Error(xhr.responseText ?? "")
      reject(
        new Error(
          detail
            ? `Storage rejected the upload — ${detail}.`
            : "Network/CORS error while uploading to storage. Check the browser devtools network tab for the failing PUT request and confirm bucket CORS allows this origin.",
        ),
      )
    }
    xhr.ontimeout = () => reject(new Error("Upload to storage timed out."))
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"))

    const onAbort = () => {
      try {
        xhr.abort()
      } catch {
        /* noop */
      }
    }
    signal.addEventListener("abort", onAbort, { once: true })

    xhr.send(file)
  })
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3))
  const value = bytes / 10 ** (i * 3)
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

type Props = {
  kind: DropzoneKind
  label: string
  helperText?: string
  value: string
  onChange: (publicUrl: string) => void
  className?: string
}

export function AdminMediaDropzone({
  kind,
  label,
  helperText,
  value,
  onChange,
  className,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState<{
    loaded: number
    total: number
  } | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  /**
   * Revoke the object URL whenever the local preview changes.
   * Do NOT touch abortRef here — that fires on every preview change and
   * would abort the upload we just started.
   */
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

  /** Abort an in-flight upload only on actual unmount. */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const uploadFile = useCallback(
    async (file: File) => {
      const mime = inferMime(file, kind)
      if (!mime) {
        toast.error(
          kind === "image"
            ? "Please pick a JPG, PNG, WEBP or GIF image."
            : "Please pick an MP4, WEBM or MOV video.",
        )
        return
      }

      const previewUrl = URL.createObjectURL(file)
      setLocalPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return previewUrl
      })
      setIsUploading(true)
      setProgress({ loaded: 0, total: file.size })

      const toastId = toast.loading(
        kind === "image" ? "Uploading image…" : "Uploading video…",
        { description: `${file.name} · ${formatBytes(file.size)}` },
      )

      abortRef.current?.abort()
      const abort = new AbortController()
      abortRef.current = abort
      const timer = window.setTimeout(() => abort.abort(), 30 * 60_000)

      try {
        const presign = await requestPresign(file, mime)
        if (abort.signal.aborted) {
          throw new DOMException("Aborted", "AbortError")
        }

        await putToS3({
          file,
          uploadUrl: presign.uploadUrl,
          contentType: mime,
          signal: abort.signal,
          onProgress: (loaded, total) => {
            setProgress({ loaded, total })
            const percent = total > 0 ? Math.floor((loaded / total) * 100) : 0
            toast.loading(
              kind === "image" ? "Uploading image…" : "Uploading video…",
              {
                id: toastId,
                description: `${file.name} · ${percent}% (${formatBytes(loaded)} / ${formatBytes(total)})`,
              },
            )
          },
        })

        onChange(presign.publicUrl)
        toast.success("Upload complete", {
          id: toastId,
          description: file.name,
        })
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        toast.error(
          aborted
            ? "Upload was cancelled."
            : err instanceof Error
              ? err.message
              : "Upload failed. Please try again.",
          { id: toastId },
        )
        setLocalPreview((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return null
        })
      } finally {
        window.clearTimeout(timer)
        if (abortRef.current === abort) {
          abortRef.current = null
        }
        setIsUploading(false)
        setProgress(null)
      }
    },
    [kind, onChange],
  )

  const handlePick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleClear = useCallback(() => {
    abortRef.current?.abort()
    onChange("")
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [onChange])

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsDragging(false)
      const file = event.dataTransfer.files?.[0]
      if (file) void uploadFile(file)
    },
    [uploadFile],
  )

  const previewSrc = localPreview ?? (value ? value : null)
  const hasPreview = Boolean(previewSrc)
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.floor((progress.loaded / progress.total) * 100))
      : null

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {helperText ? (
          <p className="text-xs text-muted-foreground">{helperText}</p>
        ) : null}
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!isDragging) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "group relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed bg-muted/30 transition-colors",
          isDragging
            ? "border-primary bg-primary/10"
            : "border-border hover:border-primary/60 hover:bg-muted/40",
          hasPreview ? "border-solid bg-card" : "",
          kind === "image" ? "aspect-video" : "aspect-video",
        )}
      >
        {hasPreview ? (
          <>
            {kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewSrc as string}
                alt="Preview"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <video
                src={previewSrc as string}
                className="absolute inset-0 h-full w-full object-cover"
                controls
                muted
                playsInline
                preload="metadata"
              />
            )}

            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-background/30 opacity-0 transition-opacity group-hover:opacity-100" />

            <div className="absolute inset-x-0 top-0 flex justify-end gap-2 p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={isUploading}
                onClick={handlePick}
                className="gap-1.5 backdrop-blur"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Replace
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleClear}
                className="gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                {isUploading ? "Cancel" : "Remove"}
              </Button>
            </div>

            {isUploading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full bg-card/80 px-4 py-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  {percent !== null ? `Uploading ${percent}%` : "Uploading…"}
                </div>
                {progress ? (
                  <div className="w-3/4 max-w-xs">
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-[width] duration-150"
                        style={{ width: `${percent ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-1 text-center text-[11px] text-muted-foreground">
                      {formatBytes(progress.loaded)} /{" "}
                      {formatBytes(progress.total)}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <button
            type="button"
            onClick={handlePick}
            disabled={isUploading}
            className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-10 text-center"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105">
              {isUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : kind === "image" ? (
                <ImageIcon className="h-5 w-5" />
              ) : (
                <Video className="h-5 w-5" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {isUploading
                  ? percent !== null
                    ? `Uploading ${percent}%`
                    : "Uploading…"
                  : kind === "image"
                    ? "Drag an image here, or click to browse"
                    : "Drag a video here, or click to browse"}
              </p>
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <UploadCloud className="h-3.5 w-3.5" />
                {kind === "image" ? "JPG, PNG, WEBP, GIF" : "MP4, WEBM, MOV"}
              </p>
            </div>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTS[kind]}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void uploadFile(file)
          }}
        />
      </div>
    </div>
  )
}
