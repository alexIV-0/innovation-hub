"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Search, X } from "lucide-react"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { VideoCard } from "@/components/video-card"
import type { VideoCardItem } from "@/lib/content-types"

type VideosBrowserProps = {
  videos: VideoCardItem[]
  initialTags?: string[]
  initialQuery?: string
}

export function VideosBrowser({ videos, initialTags, initialQuery }: VideosBrowserProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags ?? [])
  const [query, setQuery] = useState(initialQuery ?? "")
  const [aspectById, setAspectById] = useState<Record<string, number>>({})
  const [allAspectsReady, setAllAspectsReady] = useState(false)

  const normalizedQuery = query.trim().toLowerCase()

  const tags = useMemo(
    () => Array.from(new Set(videos.map((video) => video.category))).sort((a, b) => a.localeCompare(b)),
    [videos],
  )

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const video of videos) {
      counts.set(video.category, (counts.get(video.category) ?? 0) + 1)
    }
    return counts
  }, [videos])

  const filteredVideos = useMemo(
    () =>
      videos.filter((video) => {
        if (selectedTags.length > 0 && !selectedTags.includes(video.category)) return false
        if (!normalizedQuery) return true
        const haystack = `${video.title} ${video.description} ${video.category}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      }),
    [normalizedQuery, selectedTags, videos],
  )

  const updateRoute = (nextTags: string[], nextQuery?: string) => {
    const params = new URLSearchParams()
    if (nextTags.length > 0) params.set("tags", nextTags.join(","))
    if (nextQuery && nextQuery.trim()) params.set("q", nextQuery.trim())
    const next = params.toString()
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
  }

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag]
    setSelectedTags(next)
    updateRoute(next, query)
  }

  const onSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    updateRoute(selectedTags, query)
  }

  const clearFilters = () => {
    setSelectedTags([])
    setQuery("")
    updateRoute([], "")
  }

  useEffect(() => {
    let cancelled = false
    setAllAspectsReady(false)

    const loadImageAspect = (url: string): Promise<number> =>
      new Promise((resolve) => {
        const image = new Image()
        image.decoding = "async"
        image.onload = () => {
          if (image.naturalWidth > 0 && image.naturalHeight > 0) {
            resolve(image.naturalWidth / image.naturalHeight)
          } else {
            resolve(1)
          }
        }
        image.onerror = () => resolve(1)
        image.src = url
      })

    const normalizeAspect = (value: number): number =>
      Math.min(2, Math.max(0.5, Number.isFinite(value) && value > 0 ? value : 1))

    const chooseDisplayAspect = (videoAspect: number, imageAspect: number): number => {
      // If preview framing differs significantly from source video framing,
      // use preview ratio for better masonry rhythm on the listing page.
      if (Math.abs(videoAspect - imageAspect) >= 0.2) {
        return normalizeAspect(imageAspect)
      }
      return normalizeAspect(videoAspect)
    }

    const loadAspect = (videoUrl: string, thumbnailUrl: string): Promise<number> =>
      new Promise((resolve) => {
        const imageAspectPromise = loadImageAspect(thumbnailUrl)
        const video = document.createElement("video")
        video.preload = "metadata"
        video.src = videoUrl
        video.muted = true
        video.playsInline = true

        const finalize = (aspect: number) => {
          video.removeAttribute("src")
          video.load()
          resolve(Number.isFinite(aspect) && aspect > 0 ? aspect : 1)
        }

        const timeout = window.setTimeout(async () => {
          const fallbackAspect = await imageAspectPromise
          finalize(normalizeAspect(fallbackAspect))
        }, 12000)

        video.onloadedmetadata = async () => {
          window.clearTimeout(timeout)
          const imageAspect = await imageAspectPromise
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            finalize(
              chooseDisplayAspect(video.videoWidth / video.videoHeight, imageAspect),
            )
          } else {
            finalize(normalizeAspect(imageAspect))
          }
        }

        video.onerror = async () => {
          window.clearTimeout(timeout)
          const fallbackAspect = await imageAspectPromise
          finalize(normalizeAspect(fallbackAspect))
        }
      })

    void Promise.all(
      videos.map(async (video) => {
        const aspect = await loadAspect(video.videoUrl, video.thumbnail)
        return [video.id, aspect] as const
      }),
    ).then((entries) => {
      if (cancelled) return
      setAspectById(Object.fromEntries(entries))
      setAllAspectsReady(true)
    })

    return () => {
      cancelled = true
    }
  }, [videos])

  return (
    <>
      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form onSubmit={onSearchSubmit} className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, description, or tag"
              className="h-10 w-full rounded-full border border-border/70 bg-surface-2/80 pl-9 pr-4 text-sm text-foreground outline-none transition focus:border-primary/60"
            />
          </form>

          {(selectedTags.length > 0 || query.trim()) && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-surface-2/80 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              setSelectedTags([])
              updateRoute([], query)
            }}
            className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] transition ${
              selectedTags.length === 0
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border/70 bg-surface-2/80 text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({videos.length})
          </button>
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleTag(tag)}
              className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] transition ${
                selectedTags.includes(tag)
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border/70 bg-surface-2/80 text-muted-foreground hover:text-foreground"
              }`}
            >
              {tag} ({tagCounts.get(tag) ?? 0})
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.12em] text-muted-foreground">
        {selectedTags.map((tag) => (
          <span key={tag} className="rounded-full border border-primary/60 bg-primary/15 px-2.5 py-1 text-primary">
            Tag: {tag}
          </span>
        ))}
        {normalizedQuery ? (
          <span className="rounded-full border border-border/70 bg-surface-2/80 px-2.5 py-1">
            Search: {query.trim()}
          </span>
        ) : null}
        <span className="rounded-full border border-border/70 bg-surface-2/80 px-2.5 py-1">
          Results: {filteredVideos.length}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {allAspectsReady ? (
          <motion.div
          key={`${selectedTags.slice().sort().join("|") || "all"}-${normalizedQuery || "no-query"}-ready`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="mt-10 columns-1 gap-5 sm:columns-2 lg:columns-3"
          >
            {filteredVideos.map((video, index) => (
              <motion.div
                key={video.id}
                className="mb-5 break-inside-avoid"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.26, delay: Math.min(0.24, index * 0.03), ease: "easeOut" }}
              >
                <VideoCard video={video} masonry masonryAspect={aspectById[video.id]} />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="skeleton-loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-10 columns-1 gap-5 sm:columns-2 lg:columns-3"
          >
            {videos.map((video, index) => (
              <div
                key={`skeleton-${video.id}`}
                className="mb-5 break-inside-avoid overflow-hidden rounded-lg border border-border/70 bg-surface-2/80"
                style={{ aspectRatio: `${[1, 0.72, 1.28][index % 3]}` }}
              >
                <div className="h-full w-full animate-pulse bg-gradient-to-br from-surface-3 via-surface-2 to-surface-3" />
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {filteredVideos.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No videos found for selected filters.
        </p>
      ) : null}
    </>
  )
}
