import Link from "next/link"
import { ArrowRight } from "lucide-react"

import { MotionReveal } from "@/components/landing/motion-reveal"
import { Button } from "@/components/ui/button"

export function ConversionCTASection() {
  return (
    <section className="section-space-tight border-b border-border/40 bg-surface-1/70">
      <div className="section-shell">
        <MotionReveal className="premium-card rounded-[28px] p-8 text-center md:p-12">
          <p className="type-eyebrow">Get Access</p>
          <h2 className="type-h1 mt-4 text-foreground">Ready to give your team a sharper product edge?</h2>
          <p className="type-body mx-auto mt-5 max-w-2xl">
            Join early teams using Innovation Hub to convert AI insights into confident product execution.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="h-11 rounded-full px-6 shadow-glow" asChild>
              <Link href="/register">
                Get Early Access
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="h-11 rounded-full border border-border/80 bg-surface-2/90 px-6"
              asChild
            >
              <Link href="/contact">Book a Product Demo</Link>
            </Button>
          </div>
        </MotionReveal>
      </div>
    </section>
  )
}
