"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { LayoutGrid } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
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
  const { t: page } = useI18n()
  const t = useAdminI18n()
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
      const itemTags =
        item.data.tags?.length > 0
          ? item.data.tags
          : item.data.category
            ? [item.data.category]
            : []
      for (const tag of itemTags) {
        const name = tag.trim()
        if (!name) continue
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
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
      const itemTags =
        item.data.tags?.length > 0
          ? item.data.tags
          : item.data.category
            ? [item.data.category]
            : []
      if (
        category !== CONTENT_CATEGORY_ALL &&
        !itemTags.some((tag) => tag.trim() === category)
      ) {
        return false
      }
      if (!q) return true
      const data = item.data
      const tagHaystack = itemTags.join(" ").toLowerCase()
      return (
        data.title.toLowerCase().includes(q) ||
        data.description.toLowerCase().includes(q) ||
        tagHaystack.includes(q)
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
        eyebrow={page.adminContentEyebrow}
        title={page.adminContentTitle}
        description={page.adminContentDesc}
        actions={<ContentNewButton />}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={t.searchContent}
          />
          <div className="flex flex-wrap items-center gap-2">
            <ContentFilterPills<ContentKindFilter>
              value={kind}
              onChange={setKind}
              items={[
                { id: "all", label: t.all, count: kindCounts.all },
                { id: "videos", label: t.videos, count: kindCounts.videos },
                { id: "ideas", label: t.ideas, count: kindCounts.ideas },
              ]}
            />
            <ContentFilterPills<ContentStatusFilter>
              value={status}
              onChange={setStatus}
              items={[
                { id: "all", label: t.all, count: statusCounts.all },
                { id: "live", label: t.live, count: statusCounts.live },
                { id: "drafts", label: t.drafts, count: statusCounts.drafts },
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
          title={allItems.length === 0 ? t.nothingHereYet : t.nothingMatches}
          description={
            allItems.length === 0 ? t.contentEmptyDesc : t.contentNoMatchDesc
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
