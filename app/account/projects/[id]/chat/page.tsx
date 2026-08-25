import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"
import { ProjectChatPanel } from "@/components/account/sections/project-chat-panel"
import { Button } from "@/components/ui/button"
import { getCurrentUser } from "@/lib/admin-auth"
import { listProjectChatMessages } from "@/lib/repositories/project-chat"
import { resolveProjectAccess } from "@/lib/project-access"
import { syncProjectChatFromYouGile } from "@/lib/project-chat-sync"

export const dynamic = "force-dynamic"

type PageProps = {
  params: Promise<{ id: string }>
}

export default async function AccountProjectChatPage({ params }: PageProps) {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  const { id } = await params
  const access = await resolveProjectAccess(id, user.id)
  if (!access) {
    notFound()
  }
  const project = access.project

  // Fire-and-forget: the chat panel polls every ~6s and will pick up
  // whatever this sync pulls in — no reason to block first paint on YouGile.
  void syncProjectChatFromYouGile(project)
  const messages = await listProjectChatMessages(project.id)

  return (
    <div className="space-y-8">
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" asChild>
          <Link href={`/account/projects/${project.id}`}>
            <ArrowLeft className="h-4 w-4" />
            Back to project
          </Link>
        </Button>
        <AccountPageHeader eyebrow="Project chat" title={project.name} />
      </div>

      <ProjectChatPanel
        projectId={project.id}
        canWrite={access.permissions.writeChat}
        initialMessages={messages.map((m) => ({
          id: m.id,
          senderType: m.senderType,
          senderName: m.senderName,
          body: m.body,
          delivered: m.delivered,
          createdAt: m.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
