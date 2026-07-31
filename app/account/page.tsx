import { getCurrentUser } from "@/lib/admin-auth"
import { DashboardPageClient } from "@/components/account/dashboard-page"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function AccountDashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return (
    <DashboardPageClient
      fullName={user.fullName ?? ""}
      createdAt={
        user.createdAt instanceof Date
          ? user.createdAt.toISOString()
          : String(user.createdAt)
      }
    />
  )
}
