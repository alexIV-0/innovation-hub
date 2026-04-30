import { Header } from "@/components/header"
import { StatsSection } from "@/components/stats-section"
import { VideoGrid } from "@/components/video-grid"
import { FooterSection } from "@/components/footer-section"
import { HeroSection } from "@/components/hero-section"
import { getPublishedIdeas, getPublishedVideos } from "@/lib/public-data"

export const dynamic = "force-dynamic"

export default async function Home() {
  const [videos, ideas] = await Promise.all([
    getPublishedVideos(),
    getPublishedIdeas(),
  ])

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <VideoGrid videos={videos} ideas={ideas} />
        <StatsSection />
      </main>
      <FooterSection />
    </div>
  )
}
