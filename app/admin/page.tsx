import { redirect } from "next/navigation"
import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { AdminDashboard } from "@/components/admin/admin-dashboard"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AdminPage() {
  const user = await getCurrentUser()

  if (!user || !user.isActive || user.role !== "ADMIN") {
    redirect("/login")
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 py-8">
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold">Admin Panel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage ideas, videos, and user accounts.
          </p>
        </div>
        <AdminDashboard currentUserId={user.id} />
      </main>
      <FooterSection />
    </div>
  )
}
