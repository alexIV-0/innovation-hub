"use client"

import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminIdeaCard } from "@/components/admin/admin-idea-card"
import { AdminVideoCard } from "@/components/admin/admin-video-card"
import {
  contentItemFromIdea,
  contentItemFromVideo,
} from "@/components/admin/admin-types"
import type { ContentItem } from "./content-types"

type Props = {
  items: ContentItem[]
}

export function ContentGrid({ items }: Props) {
  const {
    openEdit,
    patchVideo,
    patchIdea,
    reorder,
    confirmDeleteVideo,
    confirmDeleteIdea,
  } = useAdminData()

  return (
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => {
        if (item.kind === "video") {
          const video = item.data
          return (
            <AdminVideoCard
              key={`video-${video.id}`}
              video={video}
              onEdit={() => openEdit(contentItemFromVideo(video))}
              onTogglePublish={() =>
                void patchVideo(video.id, { isPublished: !video.isPublished })
              }
              onMove={(direction) =>
                void reorder("videos", video.id, direction)
              }
              onDelete={() => confirmDeleteVideo(video)}
            />
          )
        }
        const idea = item.data
        return (
          <AdminIdeaCard
            key={`idea-${idea.id}`}
            idea={idea}
            onEdit={() => openEdit(contentItemFromIdea(idea))}
            onTogglePublish={() =>
              void patchIdea(idea.id, { isPublished: !idea.isPublished })
            }
            onMove={(direction) => void reorder("ideas", idea.id, direction)}
            onDelete={() => confirmDeleteIdea(idea)}
          />
        )
      })}
    </div>
  )
}
