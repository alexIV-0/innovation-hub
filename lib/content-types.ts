export type VideoCardItem = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  /** @deprecated Use tags; first tag for legacy UI */
  category: string
}

export type IdeaCardItem = {
  id: string
  title: string
  description: string
  tags: string[]
  /** @deprecated Use tags; first tag for legacy UI */
  category: string
}
