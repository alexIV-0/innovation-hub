import { Header } from "@/components/header"
import { StatsSection } from "@/components/stats-section"
import { VideoGrid } from "@/components/video-grid"
import { FooterSection } from "@/components/footer-section"
import { HeroSection } from "@/components/hero-section"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <VideoGrid />
        <StatsSection />
      </main>
      <FooterSection />
    </div>
  )
}
