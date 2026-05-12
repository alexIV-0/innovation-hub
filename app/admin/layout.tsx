import { redirect } from "next/navigation"
import { AdminShell } from "@/components/admin/shell/admin-shell"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser()

  if (!user || !user.isActive || user.role !== "ADMIN") {
    redirect("/login")
  }

  return (
    <AdminShell
      currentUserId={user.id}
      email={user.email}
      fullName={user.fullName ?? ""}
    >
      {children}
    </AdminShell>
  )
}
