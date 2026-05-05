"use client"

import { useRef, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Play,
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
import type { AdminVideo } from "./admin-types"

type Props = {
  video: AdminVideo
  onEdit: () => void
  onTogglePublish: () => void
  onMove: (direction: "up" | "down") => void
  onDelete: () => void
}

export function AdminVideoCard({
  video,
  onEdit,
  onTogglePublish,
  onMove,
  onDelete,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="group relative overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5"
      onMouseEnter={() => {
        setHovered(true)
        videoRef.current?.play().catch(() => {})
      }}
      onMouseLeave={() => {
        setHovered(false)
        const el = videoRef.current
        if (el) {
          el.pause()
          el.currentTime = 0
        }
      }}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {video.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={video.thumbnail}
            alt={video.title}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              hovered ? "opacity-0" : "opacity-100"
            }`}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-muted to-muted/50 text-xs text-muted-foreground">
            No thumbnail
          </div>
        )}

        {video.videoUrl ? (
          <video
            ref={videoRef}
            src={video.videoUrl}
            muted
            loop
            playsInline
            preload="none"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
              hovered ? "opacity-100" : "opacity-0"
            }`}
          />
        ) : null}

        <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />

        <div className="absolute right-3 top-3 flex items-center gap-1.5">
          {video.isPublished ? (
            <Badge className="border-transparent bg-emerald-500/90 text-white backdrop-blur-sm hover:bg-emerald-500/90">
              Live
            </Badge>
          ) : (
            <Badge variant="secondary" className="backdrop-blur-sm">
              Draft
            </Badge>
          )}
        </div>

        <div className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background/70 backdrop-blur-sm">
          <Play className="h-3.5 w-3.5 fill-foreground text-foreground" />
        </div>

        {video.duration ? (
          <div className="absolute bottom-3 right-3 rounded bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground backdrop-blur-sm">
            {video.duration}
          </div>
        ) : null}
      </div>

      <div className="flex items-start justify-between gap-2 p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          {video.category ? (
            <Badge
              variant="outline"
              className="border-primary/30 bg-primary/10 text-[10px] font-semibold uppercase tracking-wider text-primary"
            >
              {video.category}
            </Badge>
          ) : null}
          <h3 className="truncate font-display text-base font-semibold leading-tight text-foreground">
            {video.title}
          </h3>
          {video.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {video.description}
            </p>
          ) : null}
        </div>

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
              {video.isPublished ? (
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
  )
}
