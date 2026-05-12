"use client"

import Link from "next/link"
import { ArrowRight, Film, Lightbulb, UserCog } from "lucide-react"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { cn } from "@/lib/utils"

type Action = {
  title: string
  description: string
  href?: string
  onClick?: () => void
  icon: typeof Film
  accent: "primary" | "amber" | "emerald"
}

const accentStyles: Record<Action["accent"], string> = {
  primary: "from-primary/30 via-primary/10",
  amber: "from-amber-400/30 via-amber-400/10",
  emerald: "from-emerald-400/30 via-emerald-400/10",
}

const iconStyles: Record<Action["accent"], string> = {
  primary: "text-primary border-primary/40 bg-primary/15",
  amber: "text-amber-300 border-amber-300/40 bg-amber-300/15",
  emerald: "text-emerald-300 border-emerald-300/40 bg-emerald-300/15",
}

export function OverviewQuickActions() {
  const { openCreate } = useAdminData()

  const actions: Action[] = [
    {
      title: "Add a new video",
      description: "Upload media and publish in seconds",
      onClick: () => openCreate("video"),
      icon: Film,
      accent: "primary",
    },
    {
      title: "Capture an idea",
      description: "Park a concept before it disappears",
      onClick: () => openCreate("idea"),
      icon: Lightbulb,
      accent: "amber",
    },
    {
      title: "Manage people",
      description: "Promote admins & control access",
      href: "/admin/users",
      icon: UserCog,
      accent: "emerald",
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {actions.map((action) => {
        const Icon = action.icon
        const content = (
          <div className="group relative flex h-full items-start gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card/70 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-border hover:shadow-panel">
            <div
              className={cn(
                "pointer-events-none absolute inset-x-0 -top-16 h-32 bg-gradient-to-b to-transparent opacity-60 blur-2xl transition-opacity group-hover:opacity-90",
                accentStyles[action.accent],
              )}
              aria-hidden
            />
            <span
              className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                iconStyles[action.accent],
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="relative flex-1">
              <p className="font-display text-sm font-semibold text-foreground">
                {action.title}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {action.description}
              </p>
            </div>
            <ArrowRight className="relative mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        )

        if (action.href) {
          return (
            <Link key={action.title} href={action.href} className="block">
              {content}
            </Link>
          )
        }
        return (
          <button
            key={action.title}
            type="button"
            onClick={action.onClick}
            className="block w-full"
          >
            {content}
          </button>
        )
      })}
    </div>
  )
}
