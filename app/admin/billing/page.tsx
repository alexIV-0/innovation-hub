import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminBillingContent } from "@/components/admin/billing/billing-content"

export const dynamic = "force-dynamic"

export default async function AdminBillingPage() {
  await requireCapabilityPage("billing.manage")

  return <AdminBillingContent />
}
