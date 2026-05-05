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
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 transition-all hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Lightbulb className="h-5 w-5" />
        </div>

        <div className="flex items-center gap-2">
          {idea.isPublished ? (
            <Badge className="border-transparent bg-emerald-500/90 text-white hover:bg-emerald-500/90">
              Live
            </Badge>
          ) : (
            <Badge variant="secondary">Draft</Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              >
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onTogglePublish}>
                {idea.isPublished ? (
                  <>
                    <EyeOff className="h-4 w-4" />
                    Unpublish
                  </>
                ) : (
                  <>
                    <Eye className="h-4 w-4" />
                    Publish
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onMove("up")}>
                <ArrowUp className="h-4 w-4" />
                Move up
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onMove("down")}>
                <ArrowDown className="h-4 w-4" />
                Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {idea.category ? (
          <Badge
            variant="outline"
            className="w-fit border-primary/30 bg-primary/10 text-[10px] font-semibold uppercase tracking-wider text-primary"
          >
            {idea.category}
          </Badge>
        ) : null}
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
