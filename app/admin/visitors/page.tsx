import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { VisitorsContent } from "@/components/admin/visitors/visitors-content"

export const dynamic = "force-dynamic"

export default async function AdminVisitorsPage() {
  await requireCapabilityPage("visitors.view")

  return <VisitorsContent />
}
