import Link from "next/link"
import { Lightbulb, PlayCircle } from "lucide-react"

import { MotionReveal } from "@/components/landing/motion-reveal"
import { SectionHeading } from "@/components/landing/section-heading"
import { SectionShell } from "@/components/landing/section-shell"
import type { IdeaCardItem, VideoCardItem } from "@/lib/content-types"

export function InteractiveShowcaseSection({
  videos,
  ideas,
}: {
  videos: VideoCardItem[]
  ideas: IdeaCardItem[]
}) {
  const featuredVideos = videos.slice(0, 6)
  const featuredIdeas = ideas.slice(0, 3)

  return (
    <SectionShell id="showcase" className="border-b border-border/40 bg-surface-1/70">
      <MotionReveal>
        <SectionHeading
          eyebrow="Interactive Showcase"
          title="See how insight turns into build-ready opportunities."
          description="Explore real sessions and companion idea cards together, so strategy and implementation stay connected."
        />
      </MotionReveal>

      <div className="mt-12 space-y-12">
        <MotionReveal className="space-y-4">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-2xl text-foreground">Ready Showcase Videos</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Published through admin panel and ready for viewing.
              </p>
            </div>
            <Link href="/videos" className="text-xs uppercase tracking-[0.14em] text-primary">
              View all ({videos.length})
            </Link>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featuredVideos.map((video) => (
              <article
                key={video.id}
                className="group premium-card overflow-hidden rounded-2xl p-0 transition hover:-translate-y-1"
              >
                <div className="relative aspect-video overflow-hidden border-b border-border/60">
                  <Link href={`/video/${video.id}`} className="absolute inset-0 z-10" aria-label={video.title}>
                    <span className="sr-only">{video.title}</span>
                  </Link>
                  <img
                    src={video.thumbnail}
                    alt=""
                    aria-hidden
                    className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-50"
                  />
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    className="absolute inset-0 h-full w-full object-contain transition duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-background/75 via-background/0 to-transparent" />
                  <div className="absolute bottom-3 left-3 rounded-full border border-white/20 bg-background/70 px-2 py-1 text-xs text-foreground">
                    {video.duration}
                  </div>
                </div>
                <div className="space-y-2 p-4">
                  <Link
                    href={`/videos?tag=${encodeURIComponent(video.category)}`}
                    className="relative z-20 inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-primary hover:text-primary/80"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    {video.category}
                  </Link>
                  <h4 className="font-display text-lg leading-snug text-foreground">
                    <Link href={`/video/${video.id}`} className="relative z-20 hover:text-primary/90">
                      {video.title}
                    </Link>
                  </h4>
                </div>
              </article>
            ))}
          </div>
        </MotionReveal>

        <MotionReveal delay={0.1} className="space-y-4">
          <div className="mb-2">
            <h3 className="font-display text-2xl text-foreground">Ideas In Development</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              What we can build next. These concepts are currently in development.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featuredIdeas.map((idea) => (
              <article
                key={idea.id}
                className="premium-card rounded-2xl p-5 transition hover:border-primary/50 hover:bg-surface-3/80"
              >
                <div className="mb-3 flex items-center justify-between gap-4">
                  <span className="inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-xs text-muted-foreground">
                    <Lightbulb className="h-3 w-3" />
                    {idea.category}
                  </span>
                  <span className="rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-warning">
                    In development
                  </span>
                </div>
                <h4 className="font-display text-lg text-foreground">{idea.title}</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{idea.description}</p>
              </article>
            ))}
          </div>
        </MotionReveal>
      </div>
    </SectionShell>
  )
}
