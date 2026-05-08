"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { Play } from "lucide-react"
import type { VideoCardItem } from "@/lib/content-types"

export function VideoCard({
  video,
  masonry = false,
  masonryAspect,
}: {
  video: VideoCardItem
  masonry?: boolean
  masonryAspect?: number
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [mediaAspect, setMediaAspect] = useState(masonryAspect ?? 1)
  const [isThumbLoaded, setIsThumbLoaded] = useState(false)
  const [hasVideoMetadata, setHasVideoMetadata] = useState(!masonry || Number.isFinite(masonryAspect))
  const [isVideoReady, setIsVideoReady] = useState(false)

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

  const computedAspect = masonryAspect ?? mediaAspect ?? 1
  const safeAspect = Number.isFinite(computedAspect) && computedAspect > 0 ? computedAspect : 1
  const showSkeleton = masonry
    ? !Number.isFinite(masonryAspect)
    : !isThumbLoaded
  const showVideoLoading = isHovered && !isVideoReady

  return (
    <div
      className={`group relative overflow-hidden rounded-lg bg-card cursor-pointer ${
        masonry ? "w-full" : "aspect-square"
      }`}
      style={masonry ? { aspectRatio: `${safeAspect}` } : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link href={`/video/${video.id}`} className="absolute inset-0 z-10" aria-label={video.title}>
        <span className="sr-only">{video.title}</span>
      </Link>

      {/* Blurred background layer to hide letterbox gaps */}
      <img
        src={video.thumbnail}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-50"
      />

      {/* Thumbnail image */}
      <img
        src={video.thumbnail}
        alt={video.title}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget
          setIsThumbLoaded(true)
          if (naturalWidth > 0 && naturalHeight > 0) {
            if (!masonryAspect) {
              setMediaAspect(naturalWidth / naturalHeight)
            }
          }
        }}
        onError={() => setIsThumbLoaded(true)}
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
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
        preload={masonry && !masonryAspect ? "metadata" : "none"}
        onLoadStart={() => setIsVideoReady(false)}
        onCanPlay={() => setIsVideoReady(true)}
        onWaiting={() => setIsVideoReady(false)}
        onLoadedMetadata={(event) => {
          if (!masonry || masonryAspect) return
          const el = event.currentTarget
          setHasVideoMetadata(true)
          if (el.videoWidth > 0 && el.videoHeight > 0) {
            setMediaAspect(el.videoWidth / el.videoHeight)
          }
        }}
        onError={() => {
          setHasVideoMetadata(true)
          setIsVideoReady(true)
        }}
        className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-300 ${
          isHovered ? "opacity-100" : "opacity-0"
        }`}
      />

      {showSkeleton ? (
        <div className="pointer-events-none absolute inset-0 z-20 animate-pulse bg-gradient-to-br from-surface-3 via-surface-2 to-surface-3" />
      ) : null}

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

      {showVideoLoading ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background/55 backdrop-blur-sm">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-foreground/30 border-t-foreground" />
          </div>
        </div>
      ) : null}

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
        <Link
          href={`/videos?tag=${encodeURIComponent(video.category)}`}
          className="relative z-20 mb-1 inline-block rounded-sm bg-primary/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary hover:bg-primary/30"
        >
          {video.category}
        </Link>
        <h3 className="text-sm font-semibold leading-tight text-foreground font-display">
          {video.title}
        </h3>
      </div>
    </div>
  )
}
