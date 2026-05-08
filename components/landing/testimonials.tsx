import { MotionReveal } from "@/components/landing/motion-reveal"
import { SectionHeading } from "@/components/landing/section-heading"
import { SectionShell } from "@/components/landing/section-shell"

const testimonials = [
  {
    quote:
      "Innovation Hub became our weekly source of product direction. It helps us align strategy before we commit engineering time.",
    name: "Lina Hart",
    role: "Head of Product, Applied AI Studio",
  },
  {
    quote:
      "The implementation idea layer is what makes this premium. It does not just inspire us, it accelerates decisions.",
    name: "Ari Kim",
    role: "Design Lead, Venture-backed SaaS",
  },
  {
    quote:
      "The signal quality feels curated by operators, not content marketers. We now build with more conviction and less noise.",
    name: "Noah Patel",
    role: "Founder, B2B AI Platform",
  },
]

export function TestimonialsSection() {
  return null
  return (
    <SectionShell className="border-b border-border/40">
      <MotionReveal>
        <SectionHeading
          eyebrow="Testimonials"
          title="Teams use Innovation Hub to make better product calls faster."
          description="Social proof is strongest when it sounds like real operators. Keep this section short, clear, and trust-oriented."
          align="center"
        />
      </MotionReveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {testimonials.map((item, index) => (
          <MotionReveal key={item.name} delay={0.08 * index} className="premium-card rounded-2xl p-6">
            <p className="text-sm leading-relaxed text-foreground/92">&quot;{item.quote}&quot;</p>
            <div className="mt-6 border-t border-border/70 pt-4">
              <p className="font-medium text-foreground">{item.name}</p>
              <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{item.role}</p>
            </div>
          </MotionReveal>
        ))}
      </div>
    </SectionShell>
  )
}
