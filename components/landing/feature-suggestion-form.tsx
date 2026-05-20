"use client"

import { useCallback, useId, useRef, useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { FileImage, FileVideo, Loader2, Paperclip, Send, X } from "lucide-react"
import { toast } from "sonner"
import {
  featureSuggestionSchema,
  type FeatureSuggestionAttachment,
  type FeatureSuggestionInput,
} from "@/lib/feature-suggestion-schemas"
import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const MAX_FILES = 5
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.mov"
const MIN_AUTOMATION_LENGTH = 10

function RequiredFormLabel({ children }: { children: ReactNode }) {
  return (
    <FormLabel>
      {children}
      <span className="text-destructive" aria-hidden="true">
        {" "}
        *
      </span>
    </FormLabel>
  )
}

function hasRequiredFieldValues(values: {
  name: string
  email: string
  automation: string
}): boolean {
  return (
    values.name.trim().length > 0 &&
    values.email.trim().length > 0 &&
    values.automation.trim().length >= MIN_AUTOMATION_LENGTH
  )
}

type UploadItem = {
  id: string
  file: File
  progress: number
  status: "uploading" | "done" | "error"
  error?: string
  attachment?: FeatureSuggestionAttachment
}

function inferMime(file: File): string | null {
  const allowed = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ])
  if (allowed.has(file.type)) return file.type
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

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log10(bytes) / 3))
  const value = bytes / 10 ** (i * 3)
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

function uploadFile(
  file: File,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
  signal: AbortSignal,
): Promise<{ key: string; url: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    const xhr = new XMLHttpRequest()
    const params = new URLSearchParams({
      fileName: file.name,
    })
    xhr.open("POST", `/api/feature-suggestions/upload?${params}`)
    xhr.withCredentials = true
    xhr.setRequestHeader("Content-Type", contentType)
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name))

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded, event.total)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const payload = JSON.parse(xhr.responseText) as {
            key?: string
            url?: string
            contentType?: string
            message?: string
          }
          if (!payload.key || !payload.url || !payload.contentType) {
            reject(new Error("Invalid upload response."))
            return
          }
          resolve({
            key: payload.key,
            url: payload.url,
            contentType: payload.contentType,
          })
        } catch {
          reject(new Error("Invalid upload response."))
        }
        return
      }
      try {
        const payload = JSON.parse(xhr.responseText) as { message?: string }
        reject(
          new Error(payload.message ?? `Upload failed (HTTP ${xhr.status}).`),
        )
      } catch {
        reject(new Error(`Upload failed (HTTP ${xhr.status}).`))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload."))
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"))

    signal.addEventListener("abort", () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

export function FeatureSuggestionForm() {
  const inputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllers = useRef(new Map<string, AbortController>())
  const [uploads, setUploads] = useState<UploadItem[]>([])
  const [dragOver, setDragOver] = useState(false)

  const form = useForm<FeatureSuggestionInput>({
    resolver: zodResolver(featureSuggestionSchema),
    mode: "onTouched",
    reValidateMode: "onChange",
    defaultValues: {
      name: "",
      email: "",
      automation: "",
      attachments: [],
      website: "",
    },
  })

  const watched = form.watch(["name", "email", "automation"])
  const requiredFilled = hasRequiredFieldValues({
    name: watched[0] ?? "",
    email: watched[1] ?? "",
    automation: watched[2] ?? "",
  })

  const hasActiveUploads = uploads.some((u) => u.status === "uploading")
  const doneAttachments = uploads
    .filter((u) => u.status === "done" && u.attachment)
    .map((u) => u.attachment!)

  const startUpload = useCallback((file: File) => {
    const mime = inferMime(file)
    if (!mime) {
      toast.error("Unsupported file type.", {
        description: "Use JPEG, PNG, WebP, GIF, MP4, WebM, or MOV.",
      })
      return
    }

    setUploads((prev) => {
      if (prev.length >= MAX_FILES) {
        toast.error(`You can attach up to ${MAX_FILES} files.`)
        return prev
      }
      const id = crypto.randomUUID()
      const controller = new AbortController()
      abortControllers.current.set(id, controller)

      const item: UploadItem = {
        id,
        file,
        progress: 0,
        status: "uploading",
      }

      uploadFile(file, mime, (loaded, total) => {
        const pct = total > 0 ? Math.round((loaded / total) * 100) : 0
        setUploads((current) =>
          current.map((u) =>
            u.id === id ? { ...u, progress: pct } : u,
          ),
        )
      }, controller.signal)
        .then((result) => {
          setUploads((current) =>
            current.map((u) =>
              u.id === id
                ? {
                    ...u,
                    progress: 100,
                    status: "done",
                    attachment: {
                      key: result.key,
                      url: result.url,
                      name: file.name,
                      contentType: result.contentType,
                      size: file.size,
                    },
                  }
                : u,
            ),
          )
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") {
            return
          }
          const message =
            error instanceof Error ? error.message : "Upload failed."
          setUploads((current) =>
            current.map((u) =>
              u.id === id ? { ...u, status: "error", error: message } : u,
            ),
          )
          toast.error(message)
        })
        .finally(() => {
          abortControllers.current.delete(id)
        })

      return [...prev, item]
    })
  }, [])

  const removeUpload = useCallback((id: string) => {
    const controller = abortControllers.current.get(id)
    controller?.abort()
    abortControllers.current.delete(id)
    setUploads((prev) => prev.filter((u) => u.id !== id))
  }, [])

  const handleFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files)
      const remaining = MAX_FILES - uploads.length
      if (remaining <= 0) {
        toast.error(`You can attach up to ${MAX_FILES} files.`)
        return
      }
      for (const file of list.slice(0, remaining)) {
        startUpload(file)
      }
      if (list.length > remaining) {
        toast.error(`Only ${remaining} more file(s) can be added.`)
      }
    },
    [startUpload, uploads.length],
  )

  const onSubmit = async (values: FeatureSuggestionInput) => {
    if (hasActiveUploads) {
      toast.error("Wait for uploads to finish.")
      return
    }

    if (!hasRequiredFieldValues(values)) {
      toast.error("Fill in all required fields before submitting.")
      await form.trigger(["name", "email", "automation"])
      return
    }

    const payload: FeatureSuggestionInput = {
      ...values,
      attachments: doneAttachments,
      website: values.website ?? "",
    }

    try {
      const response = await fetch("/api/feature-suggestions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null

      if (!response.ok) {
        if (response.status === 401) {
          toast.error("Sign in to submit a suggestion.")
        } else {
          toast.error(data?.message ?? "Could not submit your suggestion.")
        }
        return
      }

      toast.success(data?.message ?? "Thank you! Your suggestion was submitted.")
      form.reset()
      setUploads([])
    } catch {
      toast.error("Network error. Please try again.")
    }
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="premium-card space-y-6 rounded-[28px] border border-border/70 bg-surface-2/50 p-6 md:p-8"
      >
        <p className="text-xs text-muted-foreground">
          Fields marked with <span className="text-destructive">*</span> are required.
          Media attachments are optional.
        </p>
        <div className="grid gap-5 md:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <RequiredFormLabel>Your name</RequiredFormLabel>
                <FormControl>
                  <Input
                    placeholder="Jane Doe"
                    autoComplete="name"
                    required
                    aria-required="true"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <RequiredFormLabel>Email</RequiredFormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="jane@company.com"
                    autoComplete="email"
                    required
                    aria-required="true"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="automation"
          render={({ field }) => (
            <FormItem>
              <RequiredFormLabel>What automation do you want?</RequiredFormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe the workflow, tools involved, expected outcome, and any constraints…"
                  className="min-h-[140px] resize-y"
                  required
                  aria-required="true"
                  minLength={MIN_AUTOMATION_LENGTH}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">
            Attach media <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click()
            }}
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
              if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/80 bg-background/40 px-4 py-8 text-center transition-colors",
              dragOver && "border-primary/60 bg-primary/5",
            )}
          >
            <Paperclip className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Drag & drop images or videos, or click to browse
            </p>
            <p className="text-xs text-muted-foreground/80">
              Up to {MAX_FILES} files · max 25 MB each
            </p>
          </div>
          <input
            ref={fileInputRef}
            id={inputId}
            type="file"
            accept={ACCEPT}
            multiple
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(e.target.files)
              e.target.value = ""
            }}
          />

          {uploads.length > 0 ? (
            <ul className="space-y-2">
              {uploads.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/50 px-3 py-2"
                >
                  {item.file.type.startsWith("video/") ? (
                    <FileVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(item.file.size)}
                      {item.status === "uploading"
                        ? ` · ${item.progress}%`
                        : null}
                      {item.status === "error" ? ` · ${item.error}` : null}
                    </p>
                    {item.status === "uploading" ? (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                  {item.status === "uploading" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 rounded-full"
                      onClick={() => removeUpload(item.id)}
                      aria-label={`Remove ${item.file.name}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Honeypot */}
        <input
          type="text"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          {...form.register("website")}
        />

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full rounded-full shadow-glow sm:w-auto"
          disabled={
            form.formState.isSubmitting || hasActiveUploads || !requiredFilled
          }
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Submit suggestion
            </>
          )}
        </Button>
      </form>
    </Form>
  )
}
