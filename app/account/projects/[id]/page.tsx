import { notFound, redirect } from "next/navigation"
import { ProjectDetailSection } from "@/components/account/sections/project-detail-section"
import { getCurrentUser } from "@/lib/admin-auth"
import {
  findProjectForUser,
  listProjectMedia,
} from "@/lib/repositories/projects"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AccountProjectDetailPage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  const { id } = await params
  const project = await findProjectForUser(id, user.id)
  if (!project) {
    notFound()
  }

  const media = await listProjectMedia(project.id)

  return (
    <ProjectDetailSection
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        driveFolderId: project.driveFolderId,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      }}
      media={media.map((m) => ({
        id: m.id,
        fileName: m.fileName,
        mimeType: m.mimeType,
        sizeBytes: m.sizeBytes,
        driveFileId: m.driveFileId,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  )
}
