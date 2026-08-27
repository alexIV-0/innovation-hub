import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminStatisticsContent } from "@/components/admin/statistics/statistics-content"

export const dynamic = "force-dynamic"

export default async function AdminStatisticsPage() {
  await requireCapabilityPage("statistics.view")

  return <AdminStatisticsContent />
}
