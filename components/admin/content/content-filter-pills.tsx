"use client"

import { cn } from "@/lib/utils"

type Item<T extends string> = {
  id: T
  label: string
  count?: number
}

type Props<T extends string> = {
  items: Item<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
}

export function ContentFilterPills<T extends string>({
  items,
  value,
  onChange,
  className,
}: Props<T>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card/40 p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "ml-1.5 rounded px-1.5 text-[10px] tabular-nums",
                  active
                    ? "bg-background/15 text-background"
                    : "bg-muted/50 text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
