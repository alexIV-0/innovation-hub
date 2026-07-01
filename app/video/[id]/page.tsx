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
    title: `${video.title} - FF Works`,
    description: video.description,
  }
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // listRelatedPublishedVideos already excludes `id`, so kicking it off in
  // parallel with the lookup is safe and saves a DB round-trip.
  const [video, relatedVideos] = await Promise.all([
    findPublishedVideoById(id),
    listRelatedPublishedVideos(id, 3),
  ])

  if (!video) {
    notFound()
  }

  return <VideoDetailClient video={video} relatedVideos={relatedVideos} />
}
