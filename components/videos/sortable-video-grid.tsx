"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"

import { SortableVideoCard } from "@/components/videos/sortable-video-card"
import type { VideoCardItem } from "@/lib/content-types"

type Props = {
  videos: VideoCardItem[]
  onReorder: (next: VideoCardItem[]) => void
}

/**
 * Admin-only drag-and-drop grid. Lives in its own chunk (loaded via
 * next/dynamic from VideoGridInfinite) so @dnd-kit never ships to regular
 * visitors browsing the catalog.
 */
export default function SortableVideoGrid({ videos, onReorder }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = videos.findIndex((item) => item.id === active.id)
    const newIndex = videos.findIndex((item) => item.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    onReorder(arrayMove(videos, oldIndex, newIndex))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={videos.map((v) => v.id)}
        strategy={rectSortingStrategy}
      >
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <SortableVideoCard key={video.id} video={video} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
