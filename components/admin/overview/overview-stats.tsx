"use client"

import { Activity, Film, Lightbulb, Users } from "lucide-react"
import { useAdminData } from "@/components/admin/data/admin-data-context"
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
  const publishedVideos = videos.filter((v) => v.isPublished).length
  const publishedIdeas = ideas.filter((i) => i.isPublished).length
  const activeUsers = users.filter((u) => u.isActive).length
  const admins = users.filter((u) => u.role === "ADMIN").length

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label="Videos"
        value={videos.length}
        icon={Film}
        accent="primary"
        hint={`${publishedVideos} live · ${videos.length - publishedVideos} drafts`}
        spark={buildSpark(videos.length + 7)}
      />
      <StatCard
        label="Ideas"
        value={ideas.length}
        icon={Lightbulb}
        accent="amber"
        hint={`${publishedIdeas} live · ${ideas.length - publishedIdeas} drafts`}
        spark={buildSpark(ideas.length + 11)}
      />
      <StatCard
        label="People"
        value={users.length}
        icon={Users}
        accent="emerald"
        hint={`${activeUsers} active · ${users.length - activeUsers} suspended`}
        spark={buildSpark(users.length + 5)}
      />
      <StatCard
        label="Admins"
        value={admins}
        icon={Activity}
        accent="violet"
        hint="Privileged accounts"
        spark={buildSpark(admins + 3, 6)}
      />
    </div>
  )
}
