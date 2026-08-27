import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { Suspense } from "react"
import { ContentContent } from "@/components/admin/content/content-content"

export const dynamic = "force-dynamic"

export default async function AdminContentPage() {
  await requireCapabilityPage("content.manage")

  return (
    <Suspense fallback={null}>
      <ContentContent />
    </Suspense>
  )
}
