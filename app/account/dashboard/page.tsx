import { redirect } from "next/navigation"
import { DashboardSection } from "@/components/account/sections/dashboard-section"
import { getCurrentUser } from "@/lib/admin-auth"
import { isGoogleDriveConfigured } from "@/lib/google-drive"
import { provisionUserDriveFolder } from "@/lib/provision-drive"
import {
  countMediaByUserId,
  countProjectsByUserId,
  listProjectsByUserId,
} from "@/lib/repositories/projects"
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
  const [projects, projectCount, mediaCount] = await Promise.all([
    listProjectsByUserId(user.id),
    countProjectsByUserId(user.id),
    countMediaByUserId(user.id),
  ])

  return (
    <DashboardSection
      fullName={fresh.fullName}
      email={fresh.email}
      projectCount={projectCount}
      mediaCount={mediaCount}
      projects={projects.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        driveFolderId: p.driveFolderId,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }))}
    />
  )
}
