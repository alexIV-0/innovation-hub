"use client"

import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { VideoPlayer } from "@/components/video-player"
import { VideoCard } from "@/components/video-card"
import { VideoOrderForm } from "@/components/video-order-form"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import type { VideoCardItem } from "@/lib/content-types"

export function VideoDetailClient({
  video,
  relatedVideos,
}: {
  video: VideoCardItem
  relatedVideos: VideoCardItem[]
}) {
  const router = useRouter()

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        {/* Subheader with back arrow and title */}
        <div className="border-b border-border/40 bg-card/30">
          <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
            <button
              onClick={() => router.back()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-secondary hover:text-primary"
              aria-label="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="truncate font-display text-lg font-bold text-foreground md:text-xl">
              {video.title}
            </h1>
          </div>
        </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Video player */}
        <VideoPlayer src={video.videoUrl} poster={video.thumbnail} />

        {/* Video info */}
        <div className="mt-8">
          <div className="flex flex-wrap items-center gap-2">
            {(video.tags?.length ? video.tags : video.category ? [video.category] : []).map(
              (tag) => (
                <span
                  key={tag}
                  className="rounded-sm bg-primary/15 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-primary"
                >
                  {tag}
                </span>
              ),
            )}
            <span className="text-sm text-muted-foreground">
              {video.duration}
            </span>
          </div>
          <h2 className="mt-4 font-display text-2xl font-bold text-foreground md:text-3xl">
            {video.title}
          </h2>
          <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground">
            {video.description}
          </p>
        </div>

        {/* Separator */}
        <div className="my-12 h-px bg-border" />

        {/* Related videos */}
        <section>
          <h3 className="mb-6 font-display text-xl font-bold text-foreground">
            Related Videos
          </h3>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {relatedVideos.map((v) => (
              <VideoCard key={v.id} video={v} />
            ))}
          </div>
        </section>

        <VideoOrderForm video={video} />
      </div>
      </main>
      <FooterSection />
    </div>
  )
}
