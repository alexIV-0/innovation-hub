import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { RegisterForm } from "@/components/auth/register-form"
import { readGoogleOAuthConfig } from "@/lib/google-oauth"

export default function RegisterPage() {
  const googleEnabled = readGoogleOAuthConfig() !== null

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <RegisterForm googleEnabled={googleEnabled} />
      </main>
      <FooterSection />
    </div>
  )
}
