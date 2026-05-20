import { listPublishedIdeas } from "@/lib/repositories/ideas"
import { listPublishedVideos } from "@/lib/repositories/videos"
import type { IdeaCardItem, VideoCardItem } from "@/lib/content-types"

function logPublicDataError(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[public-data] ${label}:`, message)
}

export async function getPublishedVideos(): Promise<VideoCardItem[]> {
  let videos
  try {
    videos = await listPublishedVideos()
  } catch (error) {
    logPublicDataError("listPublishedVideos", error)
    return []
  }
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
  let ideas
  try {
    ideas = await listPublishedIdeas()
  } catch (error) {
    logPublicDataError("listPublishedIdeas", error)
    return []
  }
  return ideas.map((idea) => ({
    id: idea.id,
    title: idea.title,
    description: idea.description,
    category: idea.category,
  }))
}
