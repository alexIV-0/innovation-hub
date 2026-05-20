import { redirect } from "next/navigation"
import { DangerSection } from "@/components/account/sections/danger-section"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountDangerPage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }
  return <DangerSection email={user.email} />
}
