import { redirect } from "next/navigation"
import { ProjectsSection } from "@/components/account/sections/projects-section"
import { getCurrentUser } from "@/lib/admin-auth"
import { isGoogleDriveConfigured } from "@/lib/google-drive"
import { listUserProjects } from "@/lib/project-drive"
import { provisionUserDriveFolder } from "@/lib/provision-drive"
import { countUnreadForProjects } from "@/lib/repositories/project-chat"
import { findUserById } from "@/lib/repositories/users"

export const dynamic = "force-dynamic"

export default async function AccountProjectsPage() {
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
  const projects = await listUserProjects({
    userId: fresh.id,
    userDriveFolderId: fresh.driveFolderId,
  })
  const unreadCounts = await countUnreadForProjects(projects.map((p) => p.id))

  return (
    <ProjectsSection
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
