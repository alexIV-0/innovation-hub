"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { VideoCardItem } from "@/lib/content-types"

type HeroImpactProps = {
  featuredVideo?: VideoCardItem
  videoCount: number
  ideaCount: number
  totalMinutes: number
}

export function HeroImpact({
  featuredVideo,
  videoCount,
  ideaCount,
  totalMinutes,
}: HeroImpactProps) {
  const totalHours = Math.max(1, Math.round(totalMinutes / 60))
  const posterSrc = featuredVideo?.thumbnail || "/favicon.ico"

  return (
    <section className="spotlight-band relative overflow-hidden border-b border-border/40">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_35%_24%,hsl(var(--primary)/0.2),transparent_42%)]" />
      <div className="absolute left-10 top-28 -z-10 h-64 w-64 animate-glow rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute bottom-10 right-[8%] -z-10 h-56 w-56 animate-float rounded-full bg-indigo-500/20 blur-3xl" />

      <div className="section-shell py-16 md:py-20 lg:py-24">
        {/* <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-4xl space-y-8 text-center"
        >
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface-2/80 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            AI Product Intelligence Platform
          </p>
          <div className="space-y-6">
            <h1 className="font-display text-4xl font-semibold leading-[1.04] tracking-[-0.02em] text-foreground text-balance md:text-5xl xl:text-6xl">
              Turn breakthrough talks into product strategy your team can ship.
            </h1>
            <p className="type-body mx-auto max-w-2xl">
              Innovation Hub curates high-signal AI, product, and design sessions and translates them
              into practical implementation directions for modern teams.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="h-11 rounded-full px-6 shadow-glow" asChild>
              <Link href="#showcase">
                Explore Platform
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="h-11 rounded-full border border-border/80 bg-surface-2/90 px-6"
              asChild
            >
              <Link href="/register">Get Early Access</Link>
            </Button>
          </div>
          <div className="mx-auto grid w-full max-w-xl grid-cols-3 gap-3 pt-4">
            {[
              { label: "Curated sessions", value: `${videoCount}+` },
              { label: "Execution ideas", value: `${ideaCount}+` },
              { label: "Watch hours", value: `${totalHours}+h` },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border/70 bg-surface-2/70 p-3">
                <p className="font-display text-xl text-foreground">{item.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{item.label}</p>
              </div>
            ))}
          </div>
        </motion.div> */}

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-12"
        >
          <div className="premium-card relative overflow-hidden rounded-[34px]">
            <div className="absolute inset-0 z-10 bg-gradient-to-b from-background/10 via-transparent to-background/40" />
            <div className="aspect-video overflow-hidden">
              <video
                className="h-full w-full object-cover"
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster={posterSrc}
                controls
                controlsList="nodownload"
                onContextMenu={(event) => event.preventDefault()}
                aria-hidden="true"
              >
                <source src="/promo_video.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
