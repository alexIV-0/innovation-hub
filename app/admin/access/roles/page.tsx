import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { RolesContent } from "@/components/admin/access/roles-content"

export const dynamic = "force-dynamic"

export default async function AdminRolesPage() {
  await requireCapabilityPage("users.read")

  return <RolesContent />
}
