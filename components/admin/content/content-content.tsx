"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { LayoutGrid } from "lucide-react"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { SearchInput } from "@/components/admin/shared/search-input"
import { ContentCategoryRail } from "./content-category-rail"
import { ContentFilterPills } from "./content-filter-pills"
import { ContentGrid } from "./content-grid"
import { ContentNewButton } from "./content-new-button"
import {
  CONTENT_CATEGORY_ALL,
  type ContentItem,
  type ContentKindFilter,
  type ContentStatusFilter,
} from "./content-types"

function isPublished(item: ContentItem) {
  return item.data.isPublished
}

export function ContentContent() {
  const { videos, ideas, loading } = useAdminData()
  const searchParams = useSearchParams()
  const initialKind = parseKindParam(searchParams?.get("type"))

  const [query, setQuery] = useState("")
  const [kind, setKind] = useState<ContentKindFilter>(initialKind)
  const [status, setStatus] = useState<ContentStatusFilter>("all")
  const [category, setCategory] = useState<string>(CONTENT_CATEGORY_ALL)

  useEffect(() => {
    const next = parseKindParam(searchParams?.get("type"))
    setKind(next)
  }, [searchParams])

  const allItems = useMemo<ContentItem[]>(() => {
    const v: ContentItem[] = videos.map((data) => ({ kind: "video", data }))
    const i: ContentItem[] = ideas.map((data) => ({ kind: "idea", data }))
    return [...v, ...i].sort(
      (a, b) => a.data.sortOrder - b.data.sortOrder,
    )
  }, [videos, ideas])

  const categoryEntries = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of allItems) {
      const name = item.data.category.trim()
      if (!name) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [allItems])

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allItems.filter((item) => {
      if (kind === "videos" && item.kind !== "video") return false
      if (kind === "ideas" && item.kind !== "idea") return false
      if (status === "live" && !isPublished(item)) return false
      if (status === "drafts" && isPublished(item)) return false
      if (
        category !== CONTENT_CATEGORY_ALL &&
        item.data.category.trim() !== category
      ) {
        return false
      }
      if (!q) return true
      const data = item.data
      return (
        data.title.toLowerCase().includes(q) ||
        data.description.toLowerCase().includes(q) ||
        data.category.toLowerCase().includes(q)
      )
    })
  }, [allItems, kind, status, category, query])

  const kindCounts = {
    all: allItems.length,
    videos: videos.length,
    ideas: ideas.length,
  }

  const statusCounts = {
    all: allItems.length,
    live: allItems.filter(isPublished).length,
    drafts: allItems.filter((i) => !isPublished(i)).length,
  }

  return (
    <div className="space-y-7">
      <AdminPageHeader
        eyebrow="Library"
        title="Content"
        description="Videos and ideas in one curated stream. Filter by type, status or category."
        actions={<ContentNewButton />}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Search across videos and ideas…"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ContentFilterPills<ContentKindFilter>
              value={kind}
              onChange={setKind}
              items={[
                { id: "all", label: "All", count: kindCounts.all },
                { id: "videos", label: "Videos", count: kindCounts.videos },
                { id: "ideas", label: "Ideas", count: kindCounts.ideas },
              ]}
            />
            <ContentFilterPills<ContentStatusFilter>
              value={status}
              onChange={setStatus}
              items={[
                { id: "all", label: "All", count: statusCounts.all },
                { id: "live", label: "Live", count: statusCounts.live },
                { id: "drafts", label: "Drafts", count: statusCounts.drafts },
              ]}
            />
          </div>
        </div>

        <ContentCategoryRail
          categories={categoryEntries}
          value={category}
          onChange={setCategory}
          totalCount={allItems.length}
        />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-5 w-5" />}
          title={allItems.length === 0 ? "Nothing here yet" : "Nothing matches"}
          description={
            allItems.length === 0
              ? "Add your first video or idea to fill the library."
              : "Try a different search or relax the filters."
          }
        />
      ) : (
        <ContentGrid items={filteredItems} />
      )}
    </div>
  )
}

function parseKindParam(value: string | null | undefined): ContentKindFilter {
  if (value === "videos" || value === "ideas") return value
  return "all"
}
