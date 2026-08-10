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
import { TagCombobox } from "@/components/ui/tag-combobox"
import { useAdminI18n } from "@/components/admin/admin-dict"
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
  const t = useAdminI18n()
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
        tags:
          initialItem.data.tags?.length > 0
            ? initialItem.data.tags
            : initialItem.data.category
              ? [initialItem.data.category]
              : [],
      })
    } else {
      setDraft({ ...emptyContentDraft, kind: initialKind ?? "video" })
    }
  }, [open, mode, initialItem, initialKind])

  const titleText =
    mode === "create"
      ? t.newContent
      : draft.kind === "video"
        ? t.editVideo
        : t.editIdea
  const submitText =
    mode === "create"
      ? draft.kind === "video"
        ? t.publishVideo
        : t.publishIdea
      : t.saveChanges

  const setKind = (kind: ContentKind) => {
    setDraft((prev) => ({ ...prev, kind }))
  }

  const handleSubmit = async () => {
    if (!draft.title.trim()) {
      toast.error(t.errTitle)
      return
    }
    if (draft.tags.length === 0) {
      toast.error(t.errTags)
      return
    }
    if (draft.kind === "video") {
      if (!draft.thumbnail) {
        toast.error(t.errThumbnail)
        return
      }
      if (!draft.videoUrl) {
        toast.error(t.errVideoFile)
        return
      }
    } else if (!draft.description.trim()) {
      toast.error(t.errDescription)
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
          <DialogDescription>{t.contentDialogDesc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
            <Label
              htmlFor="content-kind"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:w-16"
            >
              {t.type}
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
                    {t.video}
                  </span>
                </SelectItem>
                <SelectItem value="idea">
                  <span className="inline-flex items-center gap-2">
                    <Lightbulb className="h-3.5 w-3.5" />
                    {t.idea}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "edit" && initialItem && initialItem.kind !== draft.kind ? (
            <p className="pl-0 text-[11px] text-amber-300/90 sm:pl-[4.75rem]">
              {t.switchTypeWarn}
            </p>
          ) : null}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <AdminMediaDropzone
            kind="image"
            label={
              draft.kind === "video"
                ? t.thumbnail
                : t.thumbnailOptional
            }
            helperText={
              draft.kind === "video"
                ? t.thumbnailHintVideo
                : t.thumbnailHintIdea
            }
            value={draft.thumbnail}
            onChange={(url) =>
              setDraft((prev) => ({ ...prev, thumbnail: url }))
            }
          />
          <AdminMediaDropzone
            kind="video"
            label={
              draft.kind === "video" ? t.videoFile : t.videoFileOptional
            }
            helperText={
              draft.kind === "video"
                ? t.videoFileHint
                : t.videoFileHintIdea
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
            <Label htmlFor="content-title">{t.title}</Label>
            <Input
              id="content-title"
              placeholder={t.titlePlaceholder}
              value={draft.title}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="content-tags">{t.tags}</Label>
            <TagCombobox
              scope={draft.kind === "video" ? "videos.tags" : "ideas.tags"}
              value={draft.tags}
              onChange={(tags) => setDraft((prev) => ({ ...prev, tags }))}
              placeholder={t.tagsPlaceholder}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="content-duration">
              {draft.kind === "idea" ? t.durationOptional : t.duration}
            </Label>
            <Input
              id="content-duration"
              placeholder={t.durationHint}
              value={draft.duration}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, duration: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="content-description">{t.description}</Label>
            <Textarea
              id="content-description"
              placeholder={t.descriptionPlaceholder}
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
            {t.cancel}
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

