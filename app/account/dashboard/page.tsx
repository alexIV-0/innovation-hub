import { Suspense } from "react"
import { redirect } from "next/navigation"
import {
  DashboardProjectsOverview,
  DashboardSection,
} from "@/components/account/sections/dashboard-section"
import { Skeleton } from "@/components/ui/skeleton"
import { getCurrentUser } from "@/lib/admin-auth"
import { isGoogleDriveConfigured } from "@/lib/google-drive"
import { listUserProjects } from "@/lib/project-drive"
import { provisionUserDriveFolderBackground } from "@/lib/provision-drive"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import { countMediaByUserId } from "@/lib/repositories/projects"

export const dynamic = "force-dynamic"

export default async function AccountDashboardPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  // First visit without a Drive folder: kick provisioning off in the
  // background instead of blocking the page on a Google Drive round-trip.
  // Until it lands, listUserProjects falls back to the DB cache.
  if (isGoogleDriveConfigured() && !user.driveFolderId) {
    provisionUserDriveFolderBackground(user.id)
  }

  return (
    <DashboardSection
      fullName={user.fullName}
      email={user.email}
      memberSince={user.createdAt.toISOString()}
      projectsArea={
        <Suspense fallback={<ProjectsAreaSkeleton />}>
          <DashboardProjectsData
            userId={user.id}
            driveFolderId={user.driveFolderId}
          />
        </Suspense>
      }
    />
  )
}

/**
 * The Drive folder scan is the slowest part of this page, so it streams in
 * behind Suspense while the hero above renders immediately.
 */
async function DashboardProjectsData({
  userId,
  driveFolderId,
}: {
  userId: string
  driveFolderId: string | null
}) {
  // The list of projects comes from a live Drive folder scan (source of
  // truth for what exists), not a plain DB query — see listUserProjects.
  const [projects, mediaCount] = await Promise.all([
    listUserProjects({ userId, userDriveFolderId: driveFolderId }),
    countMediaByUserId(userId),
  ])
  const unreadCounts = await countUnreadForProjects(projects.map((p) => p.id))

  return (
    <DashboardProjectsOverview
      mediaCount={mediaCount}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        driveFolderId: p.driveFolderId,
        isActive: p.isActive,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        unreadChatCount: unreadCounts[p.id] ?? 0,
      }))}
    />
  )
}

function ProjectsAreaSkeleton() {
  return (
    <div className="space-y-10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <div className="space-y-5">
        <Skeleton className="h-6 w-44" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  )
}
