import { redirect } from "next/navigation"
import { StatisticsPageClient } from "@/components/account/statistics-page"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountStatisticsPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <StatisticsPageClient />
}
