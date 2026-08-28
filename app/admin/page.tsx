import { AdminHub } from "@/components/admin/shell/admin-hub"

export const dynamic = "force-dynamic"

/**
 * Главная страница области «Главная» — список её инструментов, а не первый из
 * них. Дашборд студии переехал на /admin/overview и стал обычным инструментом:
 * в упрощённом виде, где колонки нет, страница области — единственный способ
 * увидеть, что в ней вообще есть.
 */
export default function AdminPage() {
  return <AdminHub area="main" />
}
