"use client"

import { memo, useCallback, useRef, useState } from "react"
import Link from "next/link"
import { Play } from "lucide-react"
import type { VideoCardItem } from "@/lib/content-types"

function VideoCardInner({ video }: { video: VideoCardItem }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const displayTags =
    video.tags?.length > 0
      ? video.tags
      : video.category
        ? [video.category]
        : []

  const handleMouseEnter = useCallback(() => {
    setIsHovered(true)
    setShowPreview(true)
    requestAnimationFrame(() => {
      videoRef.current?.play().catch(() => {})
    })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false)
    setShowPreview(false)
    const el = videoRef.current
    if (el) {
      el.pause()
      el.currentTime = 0
    }
  }, [])

  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-lg bg-card"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link href={`/video/${video.id}`} className="absolute inset-0 z-10" aria-label={video.title}>
        <span className="sr-only">{video.title}</span>
      </Link>

      <img
        src={video.thumbnail}
        alt=""
        aria-hidden
        decoding="async"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-50"
      />

      <img
        src={video.thumbnail}
        alt={video.title}
        decoding="async"
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
          isHovered ? "opacity-0" : "opacity-100"
        }`}
      />

      {showPreview ? (
        <video
          ref={videoRef}
          src={video.videoUrl}
          muted
          loop
          playsInline
          preload="auto"
          className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        />
      ) : null}

      <div
        className={`pointer-events-none absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent transition-opacity duration-300 ${
          isHovered ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
          isHovered ? "opacity-0" : "opacity-100"
        }`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background/50 backdrop-blur-sm">
          <Play className="h-5 w-5 fill-foreground text-foreground" />
        </div>
      </div>

      <div
        className={`pointer-events-none absolute bottom-0 left-0 right-0 p-4 transition-all duration-300 ${
          isHovered ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        <div className="relative z-20 mb-1 flex flex-wrap gap-1">
          {displayTags.slice(0, 2).map((tag) => (
            <Link
              key={tag}
              href={`/?tags=${encodeURIComponent(tag)}`}
              className="pointer-events-auto rounded-sm bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/30"
            >
              {tag}
            </Link>
          ))}
        </div>
        <h3 className="font-display text-sm font-semibold leading-tight text-foreground">
          {video.title}
        </h3>
      </div>
    </div>
  )
}

export const VideoCard = memo(VideoCardInner)
