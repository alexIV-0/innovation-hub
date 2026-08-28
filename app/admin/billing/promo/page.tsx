import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminBillingPromo } from "@/components/admin/billing/promo-content"

export const dynamic = "force-dynamic"

export default async function AdminBillingPromoPage() {
  await requireCapabilityPage("billing.promo")

  return <AdminBillingPromo />
}
