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
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview)
    }
  }, [localPreview])

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

      const toastId = toast.loading(
        kind === "image" ? "Uploading image…" : "Uploading video…",
      )

      try {
        const formData = new FormData()
        formData.set("file", file, file.name)

        const abort = new AbortController()
        const timer = window.setTimeout(() => abort.abort(), 300_000)

        let response: Response
        try {
          response = await fetch("/api/admin/upload", {
            method: "POST",
            credentials: "same-origin",
            body: formData,
            signal: abort.signal,
          })
        } finally {
          window.clearTimeout(timer)
        }

        const payload = await response.json().catch(() => null)
        if (!response.ok || !payload || typeof payload.publicUrl !== "string") {
          const msg =
            payload && typeof payload.message === "string"
              ? payload.message
              : "Upload failed. Please try again."
          throw new Error(msg)
        }

        onChange(payload.publicUrl)
        toast.success("Upload complete", {
          id: toastId,
          description: file.name,
        })
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        toast.error(
          aborted
            ? "Upload took too long and was cancelled."
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
        setIsUploading(false)
      }
    },
    [kind, onChange],
  )

  const handlePick = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleClear = useCallback(() => {
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
                disabled={isUploading}
                onClick={handleClear}
                className="gap-1.5"
              >
                <X className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>

            {isUploading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                <div className="flex items-center gap-2 rounded-full bg-card/80 px-4 py-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  Uploading…
                </div>
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
                  ? "Uploading…"
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
