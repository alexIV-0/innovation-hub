"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { OverviewQuickActions } from "./overview-quick-actions"
import { OverviewRecentIdeas } from "./overview-recent-ideas"
import { OverviewRecentVideos } from "./overview-recent-videos"
import { OverviewStats } from "./overview-stats"
import { OverviewTeam } from "./overview-team"

export function OverviewContent() {
  const { loading, openCreate } = useAdminData()

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow="Dashboard"
        title="Studio overview"
        description="Track your content health and ship updates without leaving this page."
        actions={
          <Button onClick={() => openCreate("video")} className="gap-2 rounded-full">
            <Plus className="h-4 w-4" />
            New video
          </Button>
        }
      />

      {loading ? (
        <LoadingBlock label="Bringing your studio online…" />
      ) : (
        <>
          <OverviewStats />

          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Quick actions
            </h2>
            <OverviewQuickActions />
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <OverviewRecentVideos />
            <OverviewRecentIdeas />
          </div>

          <OverviewTeam />
        </>
      )}
    </div>
  )
}
