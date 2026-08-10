import { IBM_Plex_Sans } from "next/font/google"
import { redirect } from "next/navigation"
import { WorkspaceShell } from "@/components/account/workspace-shell"
import { AdminShell } from "@/components/admin/shell/admin-shell"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
  display: "swap",
})

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
    <div className={ibmPlex.variable}>
      <WorkspaceShell
        email={user.email}
        fullName={user.fullName ?? ""}
        role={user.role}
        balanceCents={user.balanceCents ?? 0}
      >
        <AdminShell currentUserId={user.id}>{children}</AdminShell>
      </WorkspaceShell>
    </div>
  )
}
