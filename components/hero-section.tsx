"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"
import { PlayCircle, Sparkles } from "lucide-react"

export function HeroSection() {
  return (
    <section className="flex min-h-[calc(100vh-4rem)] items-center border-b border-border/50 bg-gradient-to-b from-background via-background to-card/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-14 md:grid-cols-2 md:items-center md:py-20">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Curated technology stories
          </p>
          <h1 className="font-display text-4xl font-bold leading-tight text-foreground md:text-5xl">
            Discover what is shaping the next generation of products.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground md:text-lg">
            Watch selected talks, explore implementation ideas, and build faster with practical insights.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="#videos">
                <PlayCircle className="h-4 w-4" />
                Browse Videos
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/register">Create Account</Link>
            </Button>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-4 -z-10 rounded-3xl bg-primary/15 blur-2xl" />
          <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-xl backdrop-blur">
            <div className="aspect-video rounded-xl border border-border/80 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent p-6">
              <div className="flex h-full flex-col justify-between">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground">
                    Featured Session
                  </span>
                  <span className="text-xs text-muted-foreground">24 min</span>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Live prototype walkthrough</p>
                  <p className="mt-2 font-display text-xl font-semibold text-foreground">
                    Designing resilient interfaces for AI products
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs text-muted-foreground">Video library</p>
                <p className="mt-1 text-lg font-semibold text-foreground">50+ sessions</p>
              </div>
              <div className="rounded-lg border border-border bg-background/70 p-3">
                <p className="text-xs text-muted-foreground">Actionable ideas</p>
                <p className="mt-1 text-lg font-semibold text-foreground">30+ concepts</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
