import { Suspense } from "react"
import { WorkspacePageClient } from "@/components/account/workspace/workspace-page"

export const dynamic = "force-dynamic"

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-ws-4">
          Loading…
        </div>
      }
    >
      <WorkspacePageClient />
    </Suspense>
  )
}
