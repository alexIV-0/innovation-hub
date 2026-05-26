import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { FeatureSuggestionSection } from "@/components/landing/feature-suggestion-section"

export const dynamic = "force-dynamic"

export default function SuggestPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <FeatureSuggestionSection />
      </main>
      <FooterSection />
    </div>
  )
}
