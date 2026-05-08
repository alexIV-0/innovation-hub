import { ChartNoAxesCombined, Clock3, FolderKanban, Radar } from "lucide-react"

import { MotionReveal } from "@/components/landing/motion-reveal"
import { SectionHeading } from "@/components/landing/section-heading"
import { SectionShell } from "@/components/landing/section-shell"

const features = [
  {
    title: "Curated AI Library",
    body: "Access a hand-picked stream of talks and sessions selected for practical product impact.",
    icon: Radar,
  },
  {
    title: "Insight-to-Idea Pairing",
    body: "Every video can be paired with implementation ideas that accelerate roadmap exploration.",
    icon: FolderKanban,
  },
  {
    title: "Team-Ready Summaries",
    body: "Use concise descriptions and tags to communicate context quickly across product squads.",
    icon: ChartNoAxesCombined,
  },
  {
    title: "Always Current",
    body: "Continuously refresh your understanding of what leading teams are shipping in AI products.",
    icon: Clock3,
  },
]

export function FeatureGridSection() {
  return null
  return (
    <SectionShell className="border-b border-border/40 bg-surface-1/70">
      <MotionReveal>
        <SectionHeading
          eyebrow="Feature Grid"
          title="Purpose-built capabilities for modern AI product teams."
          description="A clean, focused surface system designed to keep attention on signal quality and execution speed."
        />
      </MotionReveal>
      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {features.map((feature, index) => (
          <MotionReveal
            key={feature.title}
            delay={0.08 * index}
            className="premium-card rounded-2xl p-6 transition hover:-translate-y-1"
          >
            <div className="mb-4 inline-flex rounded-xl border border-border/70 bg-surface-3/90 p-2.5 text-primary">
              <feature.icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-2xl text-foreground">{feature.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
          </MotionReveal>
        ))}
      </div>
    </SectionShell>
  )
}
