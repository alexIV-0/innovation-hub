"use client"

import { Plus } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
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
  const { t } = useI18n()

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.adminOverviewEyebrow}
        title={t.adminOverviewTitle}
        description={t.adminOverviewDesc}
        actions={
          <Button onClick={() => openCreate("video")} className="gap-2 rounded-full">
            <Plus className="h-4 w-4" />
            {t.adminOverviewNewVideo}
          </Button>
        }
      />

      {loading ? (
        <LoadingBlock label={t.adminOverviewLoading} />
      ) : (
        <>
          <OverviewStats />

          <section className="space-y-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {t.adminOverviewQuickActions}
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
