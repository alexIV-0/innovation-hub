"use client"
import { isElevated } from "@/lib/admin-roles"

import { Activity, Film, Lightbulb, Users } from "lucide-react"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { StatCard } from "@/components/admin/shared/stat-card"

function buildSpark(seed: number, length = 8) {
  const out: number[] = []
  let v = 4 + (seed % 5)
  for (let i = 0; i < length; i += 1) {
    v = Math.max(1, v + ((seed * (i + 3)) % 5) - 2)
    out.push(v)
  }
  return out
}

export function OverviewStats() {
  const { videos, ideas, users } = useAdminData()
  const t = useAdminI18n()
  const publishedVideos = videos.filter((v) => v.isPublished).length
  const publishedIdeas = ideas.filter((i) => i.isPublished).length
  const activeUsers = users.filter((u) => u.isActive).length
  const admins = users.filter((u) => isElevated(u.role)).length

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label={t.videos}
        value={videos.length}
        icon={Film}
        accent="primary"
        hint={tf(t.liveDraftsHint, {
          live: publishedVideos,
          drafts: videos.length - publishedVideos,
        })}
        spark={buildSpark(videos.length + 7)}
      />
      <StatCard
        label={t.ideas}
        value={ideas.length}
        icon={Lightbulb}
        accent="amber"
        hint={tf(t.liveDraftsHint, {
          live: publishedIdeas,
          drafts: ideas.length - publishedIdeas,
        })}
        spark={buildSpark(ideas.length + 11)}
      />
      <StatCard
        label={t.people}
        value={users.length}
        icon={Users}
        accent="emerald"
        hint={tf(t.activeSuspendedHint, {
          active: activeUsers,
          suspended: users.length - activeUsers,
        })}
        spark={buildSpark(users.length + 5)}
      />
      <StatCard
        label={t.admins}
        value={admins}
        icon={Activity}
        accent="violet"
        hint={t.privilegedAccounts}
        spark={buildSpark(admins + 3, 6)}
      />
    </div>
  )
}
