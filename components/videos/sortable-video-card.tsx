"use client"

import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical } from "lucide-react"

import { VideoCard } from "@/components/video-card"
import type { VideoCardItem } from "@/lib/content-types"
import { cn } from "@/lib/utils"

export function SortableVideoCard({ video }: { video: VideoCardItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: video.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("relative", isDragging && "z-30 opacity-90")}
    >
      <button
        type="button"
        className="absolute left-2 top-2 z-40 flex h-8 w-8 cursor-grab items-center justify-center rounded-md border border-border/70 bg-background/80 text-muted-foreground backdrop-blur-sm active:cursor-grabbing"
        aria-label={`Drag ${video.title}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <VideoCard video={video} />
    </div>
  )
}
