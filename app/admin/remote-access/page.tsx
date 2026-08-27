import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { RemoteAccessContent } from "@/components/admin/remote-access/remote-access-content"

export const dynamic = "force-dynamic"

export default async function AdminRemoteAccessPage() {
  await requireCapabilityPage("pipeline.operate")

  return <RemoteAccessContent />
}
