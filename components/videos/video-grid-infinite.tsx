"use client"

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2, Pencil, Search, X } from "lucide-react"
import { toast } from "sonner"

import { VideoCard } from "@/components/video-card"
import { SortableVideoCard } from "@/components/videos/sortable-video-card"
import { Button } from "@/components/ui/button"
import type { VideoCardItem } from "@/lib/content-types"
import {
  INFINITE_SCROLL_ROOT_MARGIN,
  PUBLISHED_VIDEOS_PAGE_SIZE,
} from "@/lib/videos-pagination"

type TagCount = { tag: string; count: number }

type VideoGridInfiniteProps = {
  initialVideos: VideoCardItem[]
  initialNextCursor: string | null
  initialTags?: string[]
  initialQuery?: string
  isAdmin?: boolean
}

export function VideoGridInfinite({
  initialVideos,
  initialNextCursor,
  initialTags = [],
  initialQuery = "",
  isAdmin = false,
}: VideoGridInfiniteProps) {
  const router = useRouter()
  const pathname = usePathname()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const [videos, setVideos] = useState(initialVideos)
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor)
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags)
  const [query, setQuery] = useState(initialQuery)
  const [tagCounts, setTagCounts] = useState<TagCount[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editVideos, setEditVideos] = useState<VideoCardItem[]>([])
  const [savingOrder, setSavingOrder] = useState(false)

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const loadingMoreRef = useRef(false)

  const normalizedQuery = query.trim().toLowerCase()

  const buildApiUrl = useCallback(
    (cursor?: string | null, all?: boolean) => {
      const params = new URLSearchParams()
      if (all) {
        params.set("all", "1")
      } else {
        params.set("limit", String(PUBLISHED_VIDEOS_PAGE_SIZE))
        if (cursor) params.set("cursor", cursor)
      }
      if (selectedTags.length > 0) params.set("tags", selectedTags.join(","))
      if (query.trim()) params.set("q", query.trim())
      return `/api/videos?${params}`
    },
    [query, selectedTags],
  )

  const updateRoute = useCallback(
    (nextTags: string[], nextQuery: string) => {
      const params = new URLSearchParams()
      if (nextTags.length > 0) params.set("tags", nextTags.join(","))
      if (nextQuery.trim()) params.set("q", nextQuery.trim())
      const next = params.toString()
      router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false })
    },
    [pathname, router],
  )

  const reloadFromStart = useCallback(async () => {
    const response = await fetch(buildApiUrl(null))
    if (!response.ok) return
    const data = (await response.json()) as {
      items: VideoCardItem[]
      nextCursor: string | null
    }
    setVideos(data.items)
    setNextCursor(data.nextCursor)
  }, [buildApiUrl])

  useEffect(() => {
    void fetch("/api/videos/tags")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { tags?: TagCount[] } | null) => {
        if (data?.tags) setTagCounts(data.tags)
      })
      .catch(() => {})
  }, [])

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current || editMode) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    const cursor = nextCursor
    try {
      const params = new URLSearchParams({
        limit: String(PUBLISHED_VIDEOS_PAGE_SIZE),
        cursor,
      })
      if (selectedTags.length > 0) params.set("tags", selectedTags.join(","))
      if (query.trim()) params.set("q", query.trim())
      const response = await fetch(`/api/videos?${params}`)
      if (!response.ok) return
      const data = (await response.json()) as {
        items: VideoCardItem[]
        nextCursor: string | null
      }
      setVideos((prev) => {
        const seen = new Set(prev.map((v) => v.id))
        const merged = [...prev]
        for (const item of data.items) {
          if (!seen.has(item.id)) merged.push(item)
        }
        return merged
      })
      setNextCursor(data.nextCursor)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [editMode, nextCursor, query, selectedTags])

  useEffect(() => {
    if (editMode || !nextCursor) return
    const node = sentinelRef.current
    if (!node) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore()
      },
      { rootMargin: INFINITE_SCROLL_ROOT_MARGIN },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [editMode, loadMore, nextCursor])

  const applyFilters = useCallback(
    async (nextTags: string[], nextQuery: string) => {
      setSelectedTags(nextTags)
      setQuery(nextQuery)
      updateRoute(nextTags, nextQuery)
      const params = new URLSearchParams({
        limit: String(PUBLISHED_VIDEOS_PAGE_SIZE),
      })
      if (nextTags.length > 0) params.set("tags", nextTags.join(","))
      if (nextQuery.trim()) params.set("q", nextQuery.trim())
      const response = await fetch(`/api/videos?${params}`)
      if (!response.ok) return
      const data = (await response.json()) as {
        items: VideoCardItem[]
        nextCursor: string | null
      }
      setVideos(data.items)
      setNextCursor(data.nextCursor)
    },
    [updateRoute],
  )

  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((item) => item !== tag)
      : [...selectedTags, tag]
    void applyFilters(next, query)
  }

  const onSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void applyFilters(selectedTags, query)
  }

  const clearFilters = () => {
    void applyFilters([], "")
  }

  const enterEditMode = async () => {
    const response = await fetch("/api/admin/videos", {
      credentials: "same-origin",
      cache: "no-store",
    })
    if (!response.ok) {
      toast.error("Could not load videos for editing.")
      return
    }
    const data = (await response.json()) as {
      id: string
      title: string
      description: string
      thumbnail: string
      videoUrl: string
      duration: string
      tags: string[]
      category: string
      isPublished: boolean
      sortOrder: number
    }[]
    const published = data
      .filter((row) => row.isPublished)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(
        (row): VideoCardItem => ({
          id: row.id,
          title: row.title,
          description: row.description,
          thumbnail: row.thumbnail,
          videoUrl: row.videoUrl,
          duration: row.duration,
          tags: row.tags,
          category: row.category,
        }),
      )
    setEditVideos(published)
    setEditMode(true)
  }

  const cancelEditMode = () => {
    setEditMode(false)
    setEditVideos([])
    void reloadFromStart()
  }

  const saveOrder = async () => {
    setSavingOrder(true)
    try {
      const response = await fetch("/api/admin/videos/reorder-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ids: editVideos.map((v) => v.id) }),
      })
      if (!response.ok) {
        toast.error("Could not save order.")
        return
      }
      toast.success("Grid order saved.")
      setEditMode(false)
      setEditVideos([])
      await reloadFromStart()
    } finally {
      setSavingOrder(false)
    }
  }

  const displayVideos = editMode ? editVideos : videos

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setEditVideos((items) => {
      const oldIndex = items.findIndex((item) => item.id === active.id)
      const newIndex = items.findIndex((item) => item.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return items
      return arrayMove(items, oldIndex, newIndex)
    })
  }

  const totalCount = useMemo(
    () => tagCounts.reduce((sum, row) => sum + row.count, 0),
    [tagCounts],
  )

  return (
    <section className="section-space border-b border-border/40">
      <div className="section-shell">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="type-eyebrow">Showcase</p>
            <h1 className="type-h1 mt-4 text-foreground">Videos</h1>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2">
              {!editMode ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="rounded-full"
                  onClick={() => void enterEditMode()}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit grid
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={cancelEditMode}
                    disabled={savingOrder}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="rounded-full"
                    onClick={() => void saveOrder()}
                    disabled={savingOrder}
                  >
                    {savingOrder ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Save order"
                    )}
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </div>

        {!editMode ? (
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
                onClick={() => void applyFilters([], query)}
                className={`rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-[0.12em] transition ${
                  selectedTags.length === 0
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border/70 bg-surface-2/80 text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({totalCount || videos.length})
              </button>
              {tagCounts.map(({ tag, count }) => (
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
                  {tag} ({count})
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            Drag cards to reorder the public grid. Save when finished.
          </p>
        )}

        {editMode ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={editVideos.map((v) => v.id)}
              strategy={rectSortingStrategy}
            >
              <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {editVideos.map((video) => (
                  <SortableVideoCard key={video.id} video={video} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {displayVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}

        {displayVideos.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            No videos found for selected filters.
          </p>
        ) : null}

        {!editMode && nextCursor ? (
          <div ref={sentinelRef} className="flex justify-center py-10">
            {loadingMore ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
