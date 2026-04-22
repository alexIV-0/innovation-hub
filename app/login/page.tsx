import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { LoginForm } from "@/components/auth/login-form"

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <LoginForm />
      </main>
      <FooterSection />
    </div>
  )
}
