import { notFound } from "next/navigation"
import {
  findPublishedVideoById,
  listRelatedPublishedVideos,
} from "@/lib/repositories/videos"
import { VideoDetailClient } from "./video-detail-client"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = await findPublishedVideoById(id)
  if (!video) return { title: "Not Found" }
  return {
    title: `${video.title} - Innovation HUB`,
    description: video.description,
  }
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = await findPublishedVideoById(id)

  if (!video) {
    notFound()
  }

  const relatedVideos = await listRelatedPublishedVideos(video.id, 3)

  return <VideoDetailClient video={video} relatedVideos={relatedVideos} />
}
