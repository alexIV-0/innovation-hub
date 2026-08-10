"use client"

import Link from "next/link"
import { ArrowRight, Film, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { contentItemFromVideo } from "@/components/admin/admin-types"
import { EmptyState } from "@/components/admin/shared/empty-state"

export function OverviewRecentVideos() {
  const { videos, openCreate, openEdit } = useAdminData()
  const t = useAdminI18n()
  const recent = [...videos]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 4)

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {t.showcase}
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
            {t.recentVideos}
          </h2>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Link href="/admin/content?type=videos">
            {t.viewAll}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {recent.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<Film className="h-5 w-5" />}
            title={t.noVideosYet}
            description={t.noVideosYetDesc}
            action={
              <Button
                onClick={() => openCreate("video")}
                size="sm"
                className="gap-2"
              >
                <Play className="h-3.5 w-3.5" />
                {t.addVideo}
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-border/60">
          {recent.map((video) => (
            <li key={video.id}>
              <button
                type="button"
                onClick={() => openEdit(contentItemFromVideo(video))}
                className="group flex w-full items-center gap-3 py-3 text-left transition-colors hover:text-foreground"
              >
                <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg border border-border/60 bg-muted">
                  {video.thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={video.thumbnail}
                      alt=""
                      aria-hidden
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Film className="h-4 w-4" />
                    </div>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-background/30 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="h-3.5 w-3.5 fill-white text-white" />
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {video.title || t.untitled}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {video.category || t.uncategorized}
                    {video.duration ? ` · ${video.duration}` : ""}
                  </p>
                </div>
                {video.isPublished ? (
                  <Badge className="border-transparent bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
                    {t.live}
                  </Badge>
                ) : (
                  <Badge variant="secondary">{t.draft}</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
