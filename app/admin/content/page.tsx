import { Suspense } from "react"
import { ContentContent } from "@/components/admin/content/content-content"

export const dynamic = "force-dynamic"

export default function AdminContentPage() {
  return (
    <Suspense fallback={null}>
      <ContentContent />
    </Suspense>
  )
}
