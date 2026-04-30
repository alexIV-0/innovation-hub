"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { Play } from "lucide-react"
import type { VideoCardItem } from "@/lib/content-types"

export function VideoCard({ video }: { video: VideoCardItem }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovered, setIsHovered] = useState(false)

  const handleMouseEnter = () => {
    setIsHovered(true)
    videoRef.current?.play().catch(() => {})
  }

  const handleMouseLeave = () => {
    setIsHovered(false)
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  return (
    <Link href={`/video/${video.id}`}>
      <div
        className="group relative aspect-square overflow-hidden rounded-lg bg-card cursor-pointer"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {/* Thumbnail image */}
        <img
          src={video.thumbnail}
          alt={video.title}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            isHovered ? "opacity-0" : "opacity-100"
          }`}
        />

        {/* Video preview on hover */}
        <video
          ref={videoRef}
          src={video.videoUrl}
          muted
          loop
          playsInline
          preload="none"
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Overlay gradient */}
        <div
          className={`absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent transition-opacity duration-300 ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
        />

        {/* Play icon when not hovered */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
            isHovered ? "opacity-0" : "opacity-100"
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background/50 backdrop-blur-sm">
            <Play className="h-5 w-5 text-foreground fill-foreground" />
          </div>
        </div>

        {/* Duration badge */}
        <div className="absolute right-3 top-3 rounded bg-background/70 px-2 py-0.5 text-xs font-medium text-foreground backdrop-blur-sm">
          {video.duration}
        </div>

        {/* Title on hover */}
        <div
          className={`absolute bottom-0 left-0 right-0 p-4 transition-all duration-300 ${
            isHovered
              ? "translate-y-0 opacity-100"
              : "translate-y-2 opacity-0"
          }`}
        >
          <span className="mb-1 inline-block rounded-sm bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
            {video.category}
          </span>
          <h3 className="text-sm font-semibold leading-tight text-foreground font-display">
            {video.title}
          </h3>
        </div>
      </div>
    </Link>
  )
}
