import { redirect } from "next/navigation"
import { AccountShell } from "@/components/account/shell/account-shell"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user) {
    redirect("/login")
  }

  if (!user.isActive) {
    // Suspended users have nothing actionable to do here — bounce them out so
    // they can't sit on settings pages that won't accept any of their requests.
    redirect("/")
  }

  return (
    <AccountShell
      email={user.email}
      fullName={user.fullName ?? ""}
      role={user.role}
    >
      {children}
    </AccountShell>
  )
}
