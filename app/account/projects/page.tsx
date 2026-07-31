import { Suspense } from "react"
import { WorkspacePageClient } from "@/components/account/workspace-page"

export const dynamic = "force-dynamic"

export default function ProjectsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-[#626875]">
          Loading…
        </div>
      }
    >
      <WorkspacePageClient />
    </Suspense>
  )
}
