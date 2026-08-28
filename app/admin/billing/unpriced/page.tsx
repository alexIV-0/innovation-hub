import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminBillingUnpriced } from "@/components/admin/billing/unpriced-content"

export const dynamic = "force-dynamic"

export default async function AdminBillingUnpricedPage() {
  await requireCapabilityPage("billing.manage")

  return <AdminBillingUnpriced />
}
