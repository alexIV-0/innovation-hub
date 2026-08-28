import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminServices } from "@/components/admin/services/services-content"

export const dynamic = "force-dynamic"

export default async function AdminServicesPage() {
  await requireCapabilityPage("services.manage")

  return <AdminServices />
}
