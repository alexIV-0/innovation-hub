import { notFound } from "next/navigation"
import { videos } from "@/lib/videos"
import { VideoDetailClient } from "./video-detail-client"

export function generateStaticParams() {
  return videos.map((video) => ({ id: video.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = videos.find((v) => v.id === id)
  if (!video) return { title: "Not Found" }
  return {
    title: `${video.title} - Innovation HUB`,
    description: video.description,
  }
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const video = videos.find((v) => v.id === id)

  if (!video) {
    notFound()
  }

  const relatedVideos = videos.filter((v) => v.id !== video.id).slice(0, 3)

  return <VideoDetailClient video={video} relatedVideos={relatedVideos} />
}
