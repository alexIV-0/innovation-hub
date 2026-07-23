import { notFound, redirect } from "next/navigation"
import { ProjectDetailSection } from "@/components/account/sections/project-detail-section"
import { getCurrentUser } from "@/lib/admin-auth"
import { isGoogleDriveConfigured } from "@/lib/google-drive"
import {
  loadProjectDriveState,
  type ProjectDriveState,
} from "@/lib/project-drive"
import {
  findProjectForUser,
  listProjectMedia,
  updateProject,
} from "@/lib/repositories/projects"
import { listProjectChatMessages } from "@/lib/repositories/project-chat"
import { syncProjectChatFromYouGile } from "@/lib/project-chat-sync"

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
  let project = await findProjectForUser(id, user.id)
  if (!project) {
    notFound()
  }

  // Files can land in the Drive folder outside of the site UI (automation),
  // so the cabinet reads Drive directly. The local media table is only a
  // fallback when Drive is unavailable.
  let drive: ProjectDriveState | null = null
  if (isGoogleDriveConfigured() && project.driveFolderId) {
    try {
      drive = await loadProjectDriveState(project.driveFolderId)
    } catch (error) {
      console.error("[project-drive] SSR listing failed", error)
    }
  }

  // `folderState.json` is the SSOT for automation on/off (may have been
  // toggled by the desktop app or another session). Re-sync the Postgres
  // cache on every visit so list views elsewhere in the cabinet don't drift.
  if (drive?.folderState && drive.folderState.enabled !== project.isActive) {
    const synced = await updateProject(project.id, user.id, {
      isActive: drive.folderState.enabled,
    }).catch((error) => {
      console.error("[project-drive] isActive cache hydration failed", error)
      return null
    })
    if (synced) project = synced
  }

  const media = drive ? [] : await listProjectMedia(project.id)

  // Before automation has picked the project up (no options/options.json
  // yet) the page only shows the chat — gate on Drive's live signal rather
  // than any DB flag so it tracks the actual folder state.
  const automationStarted = drive?.optionsFileExists ?? false
  await syncProjectChatFromYouGile(project)
  const chatMessages = await listProjectChatMessages(project.id)

  return (
    <ProjectDetailSection
      project={{
        id: project.id,
        name: project.name,
        description: project.description,
        driveFolderId: project.driveFolderId,
        isActive: project.isActive,
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
      drive={drive}
      automationStarted={automationStarted}
      chatMessages={chatMessages.map((m) => ({
        id: m.id,
        senderType: m.senderType,
        senderName: m.senderName,
        body: m.body,
        delivered: m.delivered,
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  )
}
