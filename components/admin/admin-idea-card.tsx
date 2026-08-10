"use client"

import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAdminI18n } from "@/components/admin/admin-dict"
import type { AdminIdea } from "./admin-types"

type Props = {
  idea: AdminIdea
  onEdit: () => void
  onTogglePublish: () => void
  onMove: (direction: "up" | "down") => void
  onDelete: () => void
}

export function AdminIdeaCard({
  idea,
  onEdit,
  onTogglePublish,
  onMove,
  onDelete,
}: Props) {
  const t = useAdminI18n()
  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest("[data-no-edit]")) return
        onEdit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onEdit()
        }
      }}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Lightbulb className="h-5 w-5" />
        </div>

        <div className="flex items-center gap-2">
          {idea.isPublished ? (
            <Badge className="border-transparent bg-emerald-500/90 text-white hover:bg-emerald-500/90">
              {t.live}
            </Badge>
          ) : (
            <Badge variant="secondary">{t.draft}</Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                data-no-edit
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">{t.actions}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                {t.edit}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onTogglePublish}>
                {idea.isPublished ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    {t.unpublish}
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    {t.publish}
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onMove("up")}>
                <ArrowUp className="h-4 w-4" />
                {t.moveUp}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMove("down")}>
                <ArrowDown className="h-4 w-4" />
                {t.moveDown}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                {t.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          {(idea.tags?.length ? idea.tags : idea.category ? [idea.category] : []).map(
            (tag) => (
              <Badge
                key={tag}
                variant="outline"
                className="w-fit border-primary/30 bg-primary/10 text-[10px] font-semibold uppercase tracking-wider text-primary"
              >
                {tag}
              </Badge>
            ),
          )}
        </div>
        <h3 className="font-display text-lg font-semibold leading-tight text-foreground">
          {idea.title}
        </h3>
        {idea.description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">
            {idea.description}
          </p>
        ) : null}
      </div>
    </div>
  )
}
