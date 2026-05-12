"use client"

import { useEffect, useState } from "react"
import { Film, Lightbulb, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AdminMediaDropzone } from "./admin-media-dropzone"
import {
  emptyContentDraft,
  type ContentDraft,
  type ContentItem,
  type ContentKind,
} from "./admin-types"

type Mode = "create" | "edit"

type Props = {
  open: boolean
  mode: Mode
  initialKind?: ContentKind
  initialItem?: ContentItem
  onOpenChange: (open: boolean) => void
  onSubmit: (
    draft: ContentDraft,
    item?: ContentItem,
  ) => Promise<boolean>
}

export function AdminContentDialog({
  open,
  mode,
  initialKind,
  initialItem,
  onOpenChange,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<ContentDraft>(emptyContentDraft)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && initialItem) {
      setDraft({
        kind: initialItem.kind,
        title: initialItem.data.title,
        description: initialItem.data.description,
        thumbnail: initialItem.data.thumbnail ?? "",
        videoUrl: initialItem.data.videoUrl ?? "",
        duration: initialItem.data.duration ?? "",
        category: initialItem.data.category,
      })
    } else {
      setDraft({ ...emptyContentDraft, kind: initialKind ?? "video" })
    }
  }, [open, mode, initialItem, initialKind])

  const titleText =
    mode === "create" ? "New content" : `Edit ${draft.kind}`
  const submitText =
    mode === "create"
      ? draft.kind === "video"
        ? "Publish video"
        : "Publish idea"
      : "Save changes"

  const setKind = (kind: ContentKind) => {
    setDraft((prev) => ({ ...prev, kind }))
  }

  const handleSubmit = async () => {
    if (!draft.title.trim()) {
      toast.error("Please add a title.")
      return
    }
    if (!draft.category.trim()) {
      toast.error("Please add a category.")
      return
    }
    if (draft.kind === "video") {
      if (!draft.thumbnail) {
        toast.error("Please upload a thumbnail image.")
        return
      }
      if (!draft.videoUrl) {
        toast.error("Please upload the video file.")
        return
      }
    } else if (!draft.description.trim()) {
      toast.error("Please add a description.")
      return
    }

    setSubmitting(true)
    const ok = await onSubmit(draft, initialItem)
    setSubmitting(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-h-[90vh] max-w-3xl overflow-y-auto"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>
            Configure media, copy and metadata. Everything updates the live
            site.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <Label
              htmlFor="content-kind"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:w-16"
            >
              Type
            </Label>
            <Select
              value={draft.kind}
              onValueChange={(value) => setKind(value as ContentKind)}
            >
              <SelectTrigger
                id="content-kind"
                className="h-10 w-full max-w-[14rem] rounded-xl border-border/70 bg-card/40 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">
                  <span className="inline-flex items-center gap-2">
                    <Film className="h-3.5 w-3.5" />
                    Video
                  </span>
                </SelectItem>
                <SelectItem value="idea">
                  <span className="inline-flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5" />
                    Idea
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "edit" && initialItem && initialItem.kind !== draft.kind ? (
            <p className="pl-0 text-[11px] text-amber-300/90 sm:pl-[4.75rem]">
              Switching type will recreate this content under the new kind —
              the record will get a new id.
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <AdminMediaDropzone
            kind="image"
            label={
              draft.kind === "video"
                ? "Thumbnail"
                : "Thumbnail (optional)"
            }
            helperText={
              draft.kind === "video"
                ? "Shown in the video grid"
                : "Helps cards stand out"
            }
            value={draft.thumbnail}
            onChange={(url) =>
              setDraft((prev) => ({ ...prev, thumbnail: url }))
            }
          />
          <AdminMediaDropzone
            kind="video"
            label={
              draft.kind === "video" ? "Video file" : "Video file (optional)"
            }
            helperText={
              draft.kind === "video"
                ? "Plays on the detail page"
                : "Attach a clip if you have one"
            }
            value={draft.videoUrl}
            onChange={(url) =>
              setDraft((prev) => ({ ...prev, videoUrl: url }))
            }
            onVideoDurationDetected={(duration) =>
              setDraft((prev) => ({ ...prev, duration }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="content-title">Title</Label>
            <Input
              id="content-title"
              placeholder="A short, descriptive title"
              value={draft.title}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-category">Category</Label>
            <Input
              id="content-category"
              placeholder="Design, Technology, …"
              value={draft.category}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, category: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-duration">
              Duration{draft.kind === "idea" ? " (optional)" : ""}
            </Label>
            <Input
              id="content-duration"
              placeholder="Auto from video file (editable)"
              value={draft.duration}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, duration: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="content-description">Description</Label>
            <Textarea
              id="content-description"
              placeholder="What is this about?"
              rows={4}
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  description: event.target.value,
                }))
              }
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {submitText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

