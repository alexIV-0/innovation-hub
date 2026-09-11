import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { AdminCompanies } from "@/components/admin/companies/companies-content"

export const dynamic = "force-dynamic"

export default async function AdminCompaniesPage() {
  await requireCapabilityPage("companies.manage")

  return <AdminCompanies />
}
