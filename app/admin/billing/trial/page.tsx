import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminBillingTrial } from "@/components/admin/billing/trial-content"

export const dynamic = "force-dynamic"

export default async function AdminBillingTrialPage() {
  await requireCapabilityPage("billing.trial")

  return <AdminBillingTrial />
}
