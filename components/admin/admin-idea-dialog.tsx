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
import { emptyIdeaDraft, type AdminIdea, type IdeaDraft } from "./admin-types"

type Mode = "create" | "edit"

type Props = {
  open: boolean
  mode: Mode
  initialIdea?: AdminIdea
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: IdeaDraft, id?: string) => Promise<boolean>
}

export function AdminIdeaDialog({
  open,
  mode,
  initialIdea,
  onOpenChange,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<IdeaDraft>(emptyIdeaDraft)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    if (mode === "edit" && initialIdea) {
      setDraft({
        title: initialIdea.title,
        description: initialIdea.description,
        category: initialIdea.category,
      })
    } else {
      setDraft(emptyIdeaDraft)
    }
  }, [open, mode, initialIdea])

  const titleText = mode === "create" ? "New idea" : "Edit idea"
  const submitText = mode === "create" ? "Publish idea" : "Save changes"

  const handleSubmit = async () => {
    if (!draft.title.trim()) {
      toast.error("Please add a title.")
      return
    }
    if (!draft.description.trim()) {
      toast.error("Please add a description.")
      return
    }

    setSubmitting(true)
    const ok = await onSubmit(draft, initialIdea?.id)
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>
            Share what makes it interesting in a few sentences.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="idea-title">Title</Label>
            <Input
              id="idea-title"
              placeholder="A short, catchy title"
              value={draft.title}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, title: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idea-category">Category</Label>
            <Input
              id="idea-category"
              placeholder="Design, Sustainability, …"
              value={draft.category}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, category: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="idea-description">Description</Label>
            <Textarea
              id="idea-description"
              placeholder="Describe the idea"
              rows={5}
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
