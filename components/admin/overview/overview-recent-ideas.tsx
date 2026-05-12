"use client"

import Link from "next/link"
import { ArrowRight, Lightbulb, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { contentItemFromIdea } from "@/components/admin/admin-types"
import { EmptyState } from "@/components/admin/shared/empty-state"

export function OverviewRecentIdeas() {
  const { ideas, openCreate, openEdit } = useAdminData()
  const recent = [...ideas]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .slice(0, 4)

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Inspiration
          </p>
          <h2 className="mt-1 font-display text-lg font-semibold text-foreground">
            Latest ideas
          </h2>
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="rounded-full text-muted-foreground hover:text-foreground"
        >
          <Link href="/admin/content?type=ideas">
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {recent.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<Lightbulb className="h-5 w-5" />}
            title="No ideas yet"
            description="Capture sparks of inspiration so they don't get lost."
            action={
              <Button
                onClick={() => openCreate("idea")}
                size="sm"
                className="gap-2"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Add an idea
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-2">
          {recent.map((idea) => (
            <li key={idea.id}>
              <button
                type="button"
                onClick={() => openEdit(contentItemFromIdea(idea))}
                className="group flex w-full items-start gap-3 rounded-xl border border-border/50 bg-background/40 p-3 text-left transition-colors hover:border-border hover:bg-background/70"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-300/15 text-amber-300">
                  <Lightbulb className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {idea.title || "Untitled"}
                  </p>
                  <p className="line-clamp-1 text-xs text-muted-foreground">
                    {idea.description || idea.category || "—"}
                  </p>
                </div>
                {idea.isPublished ? (
                  <Badge className="border-transparent bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
                    Live
                  </Badge>
                ) : (
                  <Badge variant="secondary">Draft</Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
