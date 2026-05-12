import { ArrowDown, BrainCircuit, Compass, Rocket } from "lucide-react"

import { MotionReveal } from "@/components/landing/motion-reveal"
import { SectionHeading } from "@/components/landing/section-heading"
import { SectionShell } from "@/components/landing/section-shell"

const steps = [
  {
    title: "Capture Signals",
    text: "Monitor high-quality talks and technical deep dives worth your team's attention.",
    icon: Compass,
  },
  {
    title: "Extract Insight",
    text: "Condense raw information into product principles, constraints, and market patterns.",
    icon: BrainCircuit,
  },
  {
    title: "Ship with Precision",
    text: "Translate ideas into concrete build directions and aligned execution priorities.",
    icon: Rocket,
  },
]

export function AIWorkflowVisualizationSection() {
  return null
  return (
    <SectionShell id="workflow" className="border-b border-border/40">
      <MotionReveal>
        <SectionHeading
          eyebrow="AI Workflow"
          title="A workflow designed for teams that move fast."
          description="The platform acts like an intelligence loop that keeps product direction, design quality, and engineering execution in sync."
          align="center"
        />
      </MotionReveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((step, index) => (
          <MotionReveal
            key={step.title}
            delay={0.08 * index}
            className="relative premium-card rounded-2xl p-6 text-center"
          >
            <div className="mx-auto mb-4 inline-flex rounded-full border border-primary/30 bg-primary/10 p-3 text-primary">
              <step.icon className="h-5 w-5" />
            </div>
            <h3 className="font-display text-2xl text-foreground">{step.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{step.text}</p>
            {index < steps.length - 1 ? (
              <ArrowDown className="absolute -bottom-5 left-1/2 hidden h-4 w-4 -translate-x-1/2 text-primary md:block" />
            ) : null}
          </MotionReveal>
        ))}
      </div>
    </SectionShell>
  )
}
