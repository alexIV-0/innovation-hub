import { Loader2 } from "lucide-react"

type Props = {
  label?: string
}

export function LoadingBlock({ label = "Loading…" }: Props) {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-border/70 bg-card/40 py-16 text-sm text-muted-foreground">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      {label}
    </div>
  )
}
