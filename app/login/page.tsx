import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { LoginForm } from "@/components/auth/login-form"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const redirectTo =
    next && next.startsWith("/") && !next.startsWith("//") ? next : "/"

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <LoginForm redirectTo={redirectTo} />
      </main>
      <FooterSection />
    </div>
  )
}
