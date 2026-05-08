import { cn } from "@/lib/utils"
import type { PropsWithChildren } from "react"

export function SectionShell({
  id,
  className,
  children,
}: PropsWithChildren<{ id?: string; className?: string }>) {
  return (
    <section id={id} className={cn("section-space", className)}>
      <div className="section-shell">{children}</div>
    </section>
  )
}
