import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { getPublishedIdeas, getPublishedVideos } from "@/lib/public-data"
import { HeroImpact } from "@/components/landing/hero-impact"
import { CapabilitiesSection } from "@/components/landing/capabilities"
import { InteractiveShowcaseSection } from "@/components/landing/interactive-showcase"
import { ConversionCTASection } from "@/components/landing/conversion-cta"
import { FinalEmotionalCTASection } from "@/components/landing/final-emotional-cta"

export const dynamic = "force-dynamic"

/**
 * Parses durations stored as free-form strings ("12:34", "1h 30m", "45m", "2h").
 * Used only for the hero "watch hours" stat — best-effort, never throws.
 */
function parseDurationMinutes(raw: string): number {
  if (!raw) return 0
  const trimmed = raw.trim().toLowerCase()

  // hh:mm[:ss] or mm:ss
  const colonParts = trimmed.split(":").map((p) => Number.parseInt(p, 10))
  if (colonParts.length >= 2 && colonParts.every((n) => Number.isFinite(n))) {
    if (colonParts.length === 3) {
      const [h, m] = colonParts
      return h * 60 + m
    }
    const [m] = colonParts
    return m
  }

  // "1h 30m", "2h", "45m"
  const hours = trimmed.match(/(\d+)\s*h/)?.[1]
  const minutes = trimmed.match(/(\d+)\s*m/)?.[1]
  if (hours || minutes) {
    return (Number.parseInt(hours ?? "0", 10) || 0) * 60 + (Number.parseInt(minutes ?? "0", 10) || 0)
  }

  const fallback = Number.parseInt(trimmed, 10)
  return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
}

export default async function Home() {
  const [videos, ideas] = await Promise.all([
    getPublishedVideos(),
    getPublishedIdeas(),
  ])
  const featuredVideo = videos[0]
  const totalMinutes = videos.reduce((acc, video) => acc + parseDurationMinutes(video.duration), 0)

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <HeroImpact
          featuredVideo={featuredVideo}
          videoCount={videos.length}
          ideaCount={ideas.length}
          totalMinutes={totalMinutes}
        />
        {/* <CapabilitiesSection /> */}
        <InteractiveShowcaseSection videos={videos} ideas={ideas} />
        {/* <ConversionCTASection />
        <FinalEmotionalCTASection /> */}
      </main>
      <FooterSection />
    </div>
  )
}
