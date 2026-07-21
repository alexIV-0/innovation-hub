import { redirect } from "next/navigation"
import { ProjectsSection } from "@/components/account/sections/projects-section"
import { getCurrentUser } from "@/lib/admin-auth"
import { listProjectsByUserId } from "@/lib/repositories/projects"

export const dynamic = "force-dynamic"

export default async function AccountProjectsPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  const projects = await listProjectsByUserId(user.id)

  return (
    <ProjectsSection
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
