import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminBillingRates } from "@/components/admin/billing/rates-content"

export const dynamic = "force-dynamic"

export default async function AdminBillingRatesPage() {
  await requireCapabilityPage("billing.manage")

  return <AdminBillingRates />
}
