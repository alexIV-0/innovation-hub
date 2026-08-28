import type { UserRole } from "@/lib/domain-types"
import type { AdminCapability } from "@/lib/admin-capabilities"

export type ContentKind = "video" | "idea"

export type AdminVideo = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  category: string
  isPublished: boolean
  sortOrder: number
}

export type AdminIdea = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  category: string
  isPublished: boolean
  sortOrder: number
}

export type AdminUser = {
  id: string
  fullName: string
  email: string
  role: UserRole
  /** Выданные теги разделов. У суперадмина всегда пусто — ему не проверяются. */
  capabilities: AdminCapability[]
  isActive: boolean
  createdAt: string
}

export type ContentDraft = {
  kind: ContentKind
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
}

export const emptyContentDraft: ContentDraft = {
  kind: "video",
  title: "",
  description: "",
  thumbnail: "",
  videoUrl: "",
  duration: "",
  tags: [],
}

export type ContentItem =
  | { kind: "video"; data: AdminVideo }
  | { kind: "idea"; data: AdminIdea }

export function contentItemFromVideo(video: AdminVideo): ContentItem {
  return { kind: "video", data: video }
}

export function contentItemFromIdea(idea: AdminIdea): ContentItem {
  return { kind: "idea", data: idea }
}

export function draftFromContentItem(item: ContentItem): ContentDraft {
  return {
    kind: item.kind,
    title: item.data.title,
    description: item.data.description,
    thumbnail: item.data.thumbnail,
    videoUrl: item.data.videoUrl,
    duration: item.data.duration,
    tags: item.data.tags?.length ? item.data.tags : item.data.category ? [item.data.category] : [],
  }
}
