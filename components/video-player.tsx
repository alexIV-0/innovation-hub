"use client"

import { useRef, useState, useEffect, useCallback } from "react"
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize } from "lucide-react"

interface VideoPlayerProps {
  src: string
  poster: string
}

export function VideoPlayer({ src, poster }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState("0:00")
  const [duration, setDuration] = useState("0:00")
  const [showControls, setShowControls] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const maxPlayerHeight = "72vh"
  const playerStyle = aspectRatio
    ? {
        aspectRatio: `${aspectRatio}`,
        maxHeight: maxPlayerHeight,
        width: `min(100%, calc(${maxPlayerHeight} * ${aspectRatio}))`,
      }
    : {
        aspectRatio: "16 / 9",
        maxHeight: maxPlayerHeight,
        width: "100%",
      }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  const togglePlay = async () => {
    const video = videoRef.current
    if (!video) return
    if (isPlaying) {
      video.pause()
      setIsPlaying(false)
      return
    }
    try {
      await video.play()
      setIsPlaying(true)
    } catch {
      // Autoplay blocked or playback rejected; keep UI in paused state so
      // the user can retry rather than showing a fake "playing" indicator.
      setIsPlaying(false)
    }
  }

  const toggleMute = () => {
    if (!videoRef.current) return
    videoRef.current.muted = !isMuted
    setIsMuted(!isMuted)
  }

  const toggleFullscreen = async () => {
    if (!containerRef.current) return
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch {
      // The fullscreenchange listener below will reconcile state regardless.
    }
  }

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video) return
    if (!Number.isFinite(video.duration) || video.duration <= 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pos = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    video.currentTime = pos * video.duration
  }

  const handleMouseMove = useCallback(() => {
    setShowControls(true)
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false)
    }, 2500)
  }, [isPlaying])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTimeUpdate = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        setProgress(0)
      } else {
        setProgress((video.currentTime / video.duration) * 100)
      }
      setCurrentTime(formatTime(video.currentTime))
    }
    const onLoadedMetadata = () => {
      setDuration(formatTime(video.duration))
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setAspectRatio(video.videoWidth / video.videoHeight)
      }
    }
    const onEnded = () => {
      setIsPlaying(false)
      setShowControls(true)
    }
    const onPause = () => setIsPlaying(false)
    const onPlay = () => setIsPlaying(true)

    video.addEventListener("timeupdate", onTimeUpdate)
    video.addEventListener("loadedmetadata", onLoadedMetadata)
    video.addEventListener("ended", onEnded)
    video.addEventListener("pause", onPause)
    video.addEventListener("play", onPlay)

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate)
      video.removeEventListener("loadedmetadata", onLoadedMetadata)
      video.removeEventListener("ended", onEnded)
      video.removeEventListener("pause", onPause)
      video.removeEventListener("play", onPlay)
    }
  }, [])

  // Keep the fullscreen icon in sync when the user presses Esc or the
  // browser changes fullscreen state outside of our toggle button.
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="group relative mx-auto w-full overflow-hidden rounded-lg bg-card"
      style={playerStyle}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => {
        if (isPlaying) setShowControls(false)
      }}
    >
      <video
        ref={videoRef}
        src={src}
        poster={poster}
        className="h-full w-full object-contain cursor-pointer"
        onClick={togglePlay}
        playsInline
      />

      {/* Big center play button when paused */}
      {!isPlaying && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center"
          aria-label="Play video"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/90 transition-transform hover:scale-110">
            <Play className="h-7 w-7 text-primary-foreground fill-primary-foreground ml-1" />
          </div>
        </button>
      )}

      {/* Bottom controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/80 to-transparent px-4 pb-3 pt-10 transition-opacity duration-300 ${
          showControls ? "opacity-100" : "opacity-0"
        }`}
      >
        {/* Progress bar */}
        <div
          className="mb-3 h-1 w-full cursor-pointer rounded-full bg-secondary"
          onClick={handleProgressClick}
          role="slider"
          aria-label="Video progress"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="text-foreground transition-colors hover:text-primary"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5 fill-foreground" />
              )}
            </button>
            <button
              onClick={toggleMute}
              className="text-foreground transition-colors hover:text-primary"
              aria-label={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </button>
            <span className="text-xs text-muted-foreground">
              {currentTime} / {duration}
            </span>
          </div>
          <button
            onClick={toggleFullscreen}
            className="text-foreground transition-colors hover:text-primary"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-5 w-5" />
            ) : (
              <Maximize className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
