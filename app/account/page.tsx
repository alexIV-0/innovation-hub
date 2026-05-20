import { redirect } from "next/navigation"
import { ProfileSection } from "@/components/account/sections/profile-section"
import { getCurrentUser } from "@/lib/admin-auth"

export const dynamic = "force-dynamic"

export default async function AccountProfilePage() {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }

  return (
    <ProfileSection
      user={{
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt.toISOString(),
      }}
    />
  )
}
