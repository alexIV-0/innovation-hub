"use client"

import { Plus } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { hasCapability } from "@/lib/admin-capabilities"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { OverviewQuickActions } from "./overview-quick-actions"
import { OverviewRecentIdeas } from "./overview-recent-ideas"
import { OverviewRecentVideos } from "./overview-recent-videos"
import { OverviewStats } from "./overview-stats"
import { OverviewTeam } from "./overview-team"

export function OverviewContent() {
  const { loading, openCreate, currentUserRole, currentUserCapabilities } =
    useAdminData()
  const { t } = useI18n()

  // Обзор — единственная страница без тега: сюда попадает каждый, кто вообще
  // вошёл в админку. Но собран он из чужих разделов, и показывать админу по
  // акциям «0 видео, 0 идей» — не пустая страница, а неверная: нулей там нет,
  // есть данные, которых ему не видно. Поэтому блок без тега не рисуется вовсе.
  const canContent = hasCapability(
    currentUserRole,
    currentUserCapabilities,
    "content.manage",
  )
  const canPeople = hasCapability(
    currentUserRole,
    currentUserCapabilities,
    "users.read",
  )

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={t.adminOverviewEyebrow}
        title={t.adminOverviewTitle}
        description={t.adminOverviewDesc}
        actions={
          canContent ? (
            <Button
              onClick={() => openCreate("video")}
              className="gap-2 rounded-full"
            >
              <Plus className="h-4 w-4" />
              {t.adminOverviewNewVideo}
            </Button>
          ) : null
        }
      />

      {loading ? (
        <LoadingBlock label={t.adminOverviewLoading} />
      ) : (
        <>
          {canContent || canPeople ? <OverviewStats /> : null}

          {canContent || canPeople ? (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {t.adminOverviewQuickActions}
              </h2>
              <OverviewQuickActions />
            </section>
          ) : null}

          {canContent ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <OverviewRecentVideos />
              <OverviewRecentIdeas />
            </div>
          ) : null}

          {canPeople ? <OverviewTeam /> : null}
        </>
      )}
    </div>
  )
}
