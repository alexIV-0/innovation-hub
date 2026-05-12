import { BrainCircuit, Compass, Layers3 } from "lucide-react"

import { MotionReveal } from "@/components/landing/motion-reveal"
import { SectionHeading } from "@/components/landing/section-heading"
import { SectionShell } from "@/components/landing/section-shell"

const capabilities = [
  {
    title: "Signal Curation",
    description:
      "We remove noise and surface only high-leverage sessions that matter for product, design, and AI execution.",
    icon: Compass,
  },
  {
    title: "Insight Distillation",
    description:
      "Every session is translated into concise concepts your team can debate, adapt, and apply immediately.",
    icon: BrainCircuit,
  },
  {
    title: "Execution Mapping",
    description:
      "Actionable implementation ideas bridge inspiration and build plans so strategy turns into shipped software.",
    icon: Layers3,
  },
]

export function CapabilitiesSection() {
  return (
    <SectionShell className="spotlight-band border-b border-border/40">
      <MotionReveal>
        <SectionHeading
          eyebrow="Platform Capabilities"
          title="From thought leadership to product momentum."
          description="A single operating layer for discovering signals, extracting leverage, and converting ideas into implementation moves."
        />
      </MotionReveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {capabilities.map((item, index) => (
          <MotionReveal key={item.title} delay={0.08 * index} className="premium-card p-6 transition hover:-translate-y-1">
            <div className="mb-5 inline-flex rounded-xl border border-primary/20 bg-primary/10 p-2.5 text-primary">
              <item.icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-2xl text-foreground">{item.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
          </MotionReveal>
        ))}
      </div>
    </SectionShell>
  )
}
