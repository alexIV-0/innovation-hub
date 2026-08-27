import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { UsersContent } from "@/components/admin/users/users-content"

export const dynamic = "force-dynamic"

export default async function AdminUsersPage() {
  await requireCapabilityPage("users.read")

  return <UsersContent />
}
