import { redirect } from "next/navigation"
import { SpendingPage } from "@/components/account/spending-page"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountBillingPage() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")

  return <SpendingPage />
}
