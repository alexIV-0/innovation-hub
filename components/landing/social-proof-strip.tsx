import { MotionReveal } from "@/components/landing/motion-reveal"

const logos = ["OpenAI Builders", "YC Founders", "Product Leads", "Design Teams", "AI Engineers"]

export function SocialProofStrip() {
  return null
  return (
    <section className="section-space-tight border-b border-border/40 bg-surface-1/70">
      <div className="section-shell">
        <MotionReveal className="space-y-8">
          <p className="text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Trusted signal source for teams shipping at startup speed
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {logos.map((name) => (
              <div
                key={name}
                className="rounded-xl border border-border/70 bg-surface-2/80 px-4 py-3 text-center text-sm text-foreground/90"
              >
                {name}
              </div>
            ))}
          </div>
        </MotionReveal>
      </div>
    </section>
  )
}
