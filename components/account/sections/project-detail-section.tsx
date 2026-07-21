"use client"

import Link from "next/link"
import { useCallback, useRef, useState } from "react"
import {
  ArrowLeft,
  FileImage,
  FileVideo,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react"
import { toast } from "sonner"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ProjectDetail = {
  id: string
  name: string
  description: string
  driveFolderId: string | null
  createdAt: string
  updatedAt: string
}

export type ProjectMediaItem = {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
  driveFileId: string
  createdAt: string
}

type Props = {
  project: ProjectDetail
  media: ProjectMediaItem[]
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov"

function formatBytes(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function isVideo(mime: string) {
  return mime.startsWith("video/")
}

export function ProjectDetailSection({
  project,
  media: initialMedia,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [media, setMedia] = useState(initialMedia)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const uploadFile = useCallback(
    async (file: File) => {
      setUploading(true)
      setProgress(0)
      try {
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          const qs = new URLSearchParams({ fileName: file.name })
          xhr.open(
            "POST",
            `/api/projects/${project.id}/media?${qs.toString()}`,
          )
          xhr.withCredentials = true
          if (file.type) {
            xhr.setRequestHeader("Content-Type", file.type)
          }
          xhr.setRequestHeader(
            "x-file-name",
            encodeURIComponent(file.name),
          )

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              setProgress(Math.round((event.loaded / event.total) * 100))
            }
          }

          xhr.onload = () => {
            try {
              const data = JSON.parse(xhr.responseText) as
                | (ProjectMediaItem & { message?: string })
                | { message?: string }
              if (xhr.status >= 200 && xhr.status < 300 && "id" in data) {
                setMedia((prev) => [data as ProjectMediaItem, ...prev])
                toast.success(`Uploaded ${file.name}`)
                resolve()
                return
              }
              reject(
                new Error(
                  "message" in data && data.message
                    ? data.message
                    : `Upload failed (${xhr.status})`,
                ),
              )
            } catch {
              reject(new Error(`Upload failed (${xhr.status})`))
            }
          }
          xhr.onerror = () => reject(new Error("Network error during upload."))
          xhr.send(file)
        })
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Upload failed.",
        )
      } finally {
        setUploading(false)
        setProgress(null)
      }
    },
    [project.id],
  )

  const onFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    for (const file of list) {
      await uploadFile(file)
    }
  }

  const onDelete = async (item: ProjectMediaItem) => {
    if (!window.confirm(`Delete “${item.fileName}”?`)) return
    setDeletingId(item.id)
    try {
      const response = await fetch(
        `/api/projects/${project.id}/media/${item.id}`,
        { method: "DELETE", credentials: "same-origin" },
      )
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        toast.error(data?.message ?? "Could not delete file.")
        return
      }
      setMedia((prev) => prev.filter((m) => m.id !== item.id))
      toast.success("File deleted.")
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link href="/account/projects">
            <ArrowLeft className="h-4 w-4" />
            All projects
          </Link>
        </Button>
        <AccountPageHeader
          eyebrow="Project"
          title={project.name}
          description={project.description}
        />
      </div>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Upload media
        </h2>
        <p className="text-sm text-muted-foreground">
          Add images and videos for this project.
        </p>

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onClick={() => !uploading && inputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            if (uploading) return
            if (e.dataTransfer.files?.length) {
              void onFiles(e.dataTransfer.files)
            }
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-12 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/10"
              : "border-border/70 bg-[hsl(var(--surface-1))]/40 hover:border-primary/50",
            uploading && "pointer-events-none opacity-70",
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm font-medium">
                Uploading…{progress != null ? ` ${progress}%` : ""}
              </p>
            </>
          ) : (
            <>
              <UploadCloud className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  Drop files here or click to browse
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  JPG, PNG, WebP, GIF, MP4, WebM, MOV
                </p>
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              if (e.target.files?.length) {
                void onFiles(e.target.files)
                e.target.value = ""
              }
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-lg font-semibold tracking-tight">
          Media ({media.length})
        </h2>
        {media.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No files uploaded yet.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {media.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-white/[0.03] text-muted-foreground">
                  {isVideo(item.mimeType) ? (
                    <FileVideo className="h-4 w-4" />
                  ) : (
                    <FileImage className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(item.sizeBytes)} · {formatDate(item.createdAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive"
                  disabled={deletingId === item.id}
                  onClick={() => onDelete(item)}
                  aria-label={`Delete ${item.fileName}`}
                >
                  {deletingId === item.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
