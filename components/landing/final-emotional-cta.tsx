import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { MotionReveal } from "@/components/landing/motion-reveal"
import { Button } from "@/components/ui/button"

export function FinalEmotionalCTASection() {
  return (
    <section className="relative overflow-hidden py-20 md:py-24">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_10%,hsl(var(--primary)/0.2),transparent_44%)]" />
      <div className="section-shell">
        <MotionReveal className="mx-auto max-w-3xl text-center">
          <h2 className="type-h1 mt-4 text-foreground">
            Build products that feel inevitable, not improvised.
          </h2>
          <p className="type-body mt-5">
            Better AI products start with better signals. Start with a platform designed for teams that value
            quality, speed, and conviction.
          </p>
          <Button size="lg" className="mt-8 h-11 rounded-full px-6 shadow-glow-soft" asChild>
            <Link href="/register">
              Start Your Access
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </MotionReveal>
      </div>
    </section>
  )
}
