import { redirect } from "next/navigation"
import { DashboardSection } from "@/components/account/sections/dashboard-section"
import { getCurrentUser } from "@/lib/admin-auth"
import { isGoogleDriveConfigured } from "@/lib/google-drive"
import { listUserProjects } from "@/lib/project-drive"
import { provisionUserDriveFolder } from "@/lib/provision-drive"
import { countMediaByUserId } from "@/lib/repositories/projects"
import { findUserById } from "@/lib/repositories/users"

export const dynamic = "force-dynamic"

export default async function AccountDashboardPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  if (isGoogleDriveConfigured() && !user.driveFolderId) {
    await provisionUserDriveFolder(user.id)
  }

  const fresh = (await findUserById(user.id)) ?? user

  // The list of projects comes from a live Drive folder scan (source of
  // truth for what exists), not a plain DB query — see listUserProjects.
  const [projects, mediaCount] = await Promise.all([
    listUserProjects({
      userId: fresh.id,
      userDriveFolderId: fresh.driveFolderId,
    }),
    countMediaByUserId(fresh.id),
  ])

  return (
    <DashboardSection
      fullName={fresh.fullName}
      email={fresh.email}
      memberSince={fresh.createdAt.toISOString()}
      projectCount={projects.length}
      mediaCount={mediaCount}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        driveFolderId: p.driveFolderId,
        isActive: p.isActive,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }))}
    />
  )
}
