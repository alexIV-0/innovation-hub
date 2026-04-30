import { listPublishedIdeas } from "@/lib/repositories/ideas"
import { listPublishedVideos } from "@/lib/repositories/videos"
import type { IdeaCardItem, VideoCardItem } from "@/lib/content-types"

export async function getPublishedVideos(): Promise<VideoCardItem[]> {
  const videos = await listPublishedVideos()
  return videos.map((video) => ({
    id: video.id,
    title: video.title,
    description: video.description,
    thumbnail: video.thumbnail,
    videoUrl: video.videoUrl,
    duration: video.duration,
    category: video.category,
  }))
}

export async function getPublishedIdeas(): Promise<IdeaCardItem[]> {
  const ideas = await listPublishedIdeas()
  return ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    description: idea.description,
    category: idea.category,
  }))
}
