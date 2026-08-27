import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AuditContent } from "@/components/admin/audit/audit-content"

export const dynamic = "force-dynamic"

export default async function AdminAuditPage() {
  await requireCapabilityPage("audit.view")

  return <AuditContent />
}
