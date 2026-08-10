"use client"

import { Tag } from "lucide-react"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { CONTENT_CATEGORY_ALL } from "./content-types"
import { cn } from "@/lib/utils"

type CategoryEntry = { name: string; count: number }

type Props = {
  categories: CategoryEntry[]
  value: string
  onChange: (value: string) => void
  totalCount: number
}

export function ContentCategoryRail({
  categories,
  value,
  onChange,
  totalCount,
}: Props) {
  const t = useAdminI18n()
  if (categories.length === 0) return null

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-background to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent"
        aria-hidden
      />
      <div className="scrollbar-elegant flex items-center gap-2 overflow-x-auto pb-2">
        <span className="flex shrink-0 items-center gap-1.5 pl-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <Tag className="h-3.5 w-3.5" />
          {t.categories}
        </span>
        <CategoryPill
          label={t.all}
          count={totalCount}
          active={value === CONTENT_CATEGORY_ALL}
          onClick={() => onChange(CONTENT_CATEGORY_ALL)}
        />
        {categories.map((category) => (
          <CategoryPill
            key={category.name}
            label={category.name}
            count={category.count}
            active={value === category.name}
            onClick={() => onChange(category.name)}
          />
        ))}
        <span className="shrink-0 pr-1" aria-hidden />
      </div>
    </div>
  )
}

function CategoryPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/70 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      <span className="max-w-[12rem] truncate">{label}</span>
      <span
        className={cn(
          "rounded px-1.5 text-[10px] tabular-nums",
          active
            ? "bg-primary/20 text-primary"
            : "bg-muted/40 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  )
}
