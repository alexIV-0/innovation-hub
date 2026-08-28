import { requireCapabilityPage } from "@/lib/admin-page-guard"
import { WorkspacesContent } from "@/components/admin/workspaces/workspaces-content"

export const dynamic = "force-dynamic"

/**
 * Страница открыта по ступени 1 (`projects.access`): помогать с чужими файлами
 * можно, не имея права распоряжаться проектами. Ступень 2 (`projects.manage`)
 * гасит действия внутри страницы, а не саму страницу — так же, как «Завести
 * человека» на /admin/users. Разбор — docs/ADMIN_WORKSPACE_PLAN.md §3.
 */
export default async function AdminWorkspacesPage() {
  await requireCapabilityPage("projects.access")

  return <WorkspacesContent />
}
