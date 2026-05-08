"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { AdminMediaDropzone } from "./admin-media-dropzone"
import { emptyVideoDraft, type AdminVideo, type VideoDraft } from "./admin-types"

type Mode = "create" | "edit"

type Props = {
  open: boolean
  mode: Mode
  initialVideo?: AdminVideo
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: VideoDraft, id?: string) => Promise<boolean>
}

export function AdminVideoDialog({
  open,
  mode,
  initialVideo,
  onOpenChange,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<VideoDraft>(emptyVideoDraft)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && initialVideo) {
      setDraft({
        title: initialVideo.title,
        description: initialVideo.description,
        thumbnail: initialVideo.thumbnail,
        videoUrl: initialVideo.videoUrl,
        duration: initialVideo.duration,
        category: initialVideo.category,
      })
    } else {
      setDraft(emptyVideoDraft)
    }
  }, [open, mode, initialVideo])

  const titleText = mode === "create" ? "New video" : "Edit video"
  const submitText = mode === "create" ? "Publish video" : "Save changes"

  const handleSubmit = async () => {
    if (!draft.title.trim()) {
      toast.error("Please add a title.")
      return
    }
    if (!draft.thumbnail) {
      toast.error("Please upload a thumbnail image.")
      return
    }
    if (!draft.videoUrl) {
      toast.error("Please upload the video file.")
      return
    }

    setSubmitting(true)
    const ok = await onSubmit(draft, initialVideo?.id)
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
            Upload media and fill in the details. Everything updates the live site.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-2">
          <AdminMediaDropzone
            kind="image"
            label="Thumbnail"
            helperText="Shown in the video grid"
            value={draft.thumbnail}
            onChange={(url) => setDraft((prev) => ({ ...prev, thumbnail: url }))}
          />
          <AdminMediaDropzone
            kind="video"
            label="Video file"
            helperText="Plays on the detail page"
            value={draft.videoUrl}
            onChange={(url) => setDraft((prev) => ({ ...prev, videoUrl: url }))}
            onVideoDurationDetected={(duration) =>
              setDraft((prev) => ({ ...prev, duration }))
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="video-title">Title</Label>
            <Input
              id="video-title"
              placeholder="A short, descriptive title"
              value={draft.title}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="video-category">Category</Label>
            <Input
              id="video-category"
              placeholder="Design, Technology, …"
              value={draft.category}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, category: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="video-duration">Duration</Label>
            <Input
              id="video-duration"
              placeholder="Auto from video file (editable)"
              value={draft.duration}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, duration: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="video-description">Description</Label>
            <Textarea
              id="video-description"
              placeholder="What is this video about?"
              rows={4}
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
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
