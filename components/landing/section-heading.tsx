import { cn } from "@/lib/utils"
import type { ReactNode } from "react"

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: {
  eyebrow?: string
  title: string
  description?: string
  align?: "left" | "center"
}) {
  return (
    <div className={cn("max-w-3xl space-y-4", align === "center" && "mx-auto text-center")}>
      {eyebrow ? <p className="type-eyebrow">{eyebrow}</p> : null}
      <h2 className="type-h2 text-foreground">{title}</h2>
      {description ? <p className="type-body">{description}</p> : null}
    </div>
  )
}

export function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-border/80 bg-surface-2/80 px-3 py-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  )
}
