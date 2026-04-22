"use client"

import { videos } from "@/lib/videos"
import { VideoCard } from "@/components/video-card"
import { Lightbulb } from "lucide-react"

const ideas = [
  {
    id: 1,
    title: "AI-Powered Video Summarization",
    description: "Automatically generate concise summaries of long-form video content using machine learning algorithms.",
    category: "AI/ML",
  },
  {
    id: 2,
    title: "Interactive Video Annotations",
    description: "Allow viewers to add timestamps, notes, and collaborative comments directly on video timelines.",
    category: "UX",
  },
  {
    id: 3,
    title: "Real-time Translation Overlay",
    description: "Implement live subtitle translation for multilingual accessibility in video content.",
    category: "Accessibility",
  },
  {
    id: 4,
    title: "Smart Content Recommendations",
    description: "Build a recommendation engine that suggests related videos based on viewing patterns and preferences.",
    category: "AI/ML",
  },
  {
    id: 5,
    title: "Video Analytics Dashboard",
    description: "Create comprehensive analytics for tracking engagement, watch time, and viewer behavior.",
    category: "Analytics",
  },
  {
    id: 6,
    title: "Collaborative Editing Platform",
    description: "Enable multiple users to edit and review video projects simultaneously in real-time.",
    category: "Collaboration",
  },
]

export function VideoGrid() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      <div id="videos" className="mb-14">
        <h2 className="mb-6 font-display text-2xl font-bold text-foreground md:text-3xl">
          Videos
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} />
          ))}
        </div>
      </div>

      <div id="ideas">
        <h2 className="mb-6 font-display text-2xl font-bold text-foreground md:text-3xl">
          Ideas for Implementation
        </h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {ideas.map((idea) => (
            <div
              key={idea.id}
              className="group rounded-lg border border-border bg-card p-5 transition-all hover:border-primary/50 hover:bg-card/80"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Lightbulb className="h-5 w-5" />
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
                  {idea.category}
                </span>
              </div>
              <h3 className="mb-2 font-display text-lg font-semibold text-foreground">
                {idea.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {idea.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
