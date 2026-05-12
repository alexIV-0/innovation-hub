import { Header } from "@/components/header"
import { FooterSection } from "@/components/footer-section"
import { getPublishedIdeas, getPublishedVideos } from "@/lib/public-data"
import { HeroImpact } from "@/components/landing/hero-impact"
import { SocialProofStrip } from "@/components/landing/social-proof-strip"
import { CapabilitiesSection } from "@/components/landing/capabilities"
import { InteractiveShowcaseSection } from "@/components/landing/interactive-showcase"
import { AIWorkflowVisualizationSection } from "@/components/landing/ai-workflow"
import { FeatureGridSection } from "@/components/landing/feature-grid"
import { TestimonialsSection } from "@/components/landing/testimonials"
import { ConversionCTASection } from "@/components/landing/conversion-cta"
import { FinalEmotionalCTASection } from "@/components/landing/final-emotional-cta"

export const dynamic = "force-dynamic"

function parseDurationMinutes(raw: string): number {
  const amount = Number.parseInt(raw, 10)
  if (Number.isNaN(amount) || amount <= 0) return 0
  return /h/i.test(raw) ? amount * 60 : amount
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
        <SocialProofStrip />
        <CapabilitiesSection />
        <InteractiveShowcaseSection videos={videos} ideas={ideas} />
        <AIWorkflowVisualizationSection />
        <FeatureGridSection />
        <TestimonialsSection />
        <ConversionCTASection />
        <FinalEmotionalCTASection />
      </main>
      <FooterSection />
    </div>
  )
}
