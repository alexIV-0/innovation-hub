"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Command as CommandPrimitive } from "cmdk"
import { X } from "lucide-react"
import { toast } from "sonner"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { normalizeTag } from "@/lib/tags"

type SuggestionItem = {
  value: string
  usageCount: number
}

type TagComboboxProps = {
  scope: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  allowCreate?: boolean
  allowDeleteFromStore?: boolean
  className?: string
}

function tagKey(tag: string) {
  return tag.toLowerCase()
}

export function TagCombobox({
  scope,
  value,
  onChange,
  placeholder = "Select…",
  allowCreate = true,
  allowDeleteFromStore = true,
  className,
}: TagComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([])
  const [loading, setLoading] = useState(false)

  const selectedKeys = useMemo(() => new Set(value.map(tagKey)), [value])

  const fetchSuggestions = useCallback(
    async (search: string) => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ scope })
        if (search.trim()) params.set("q", search.trim())
        const response = await fetch(`/api/tag-suggestions?${params}`)
        if (!response.ok) return
        const data = (await response.json()) as {
          items?: { value: string; usageCount: number }[]
        }
        setSuggestions(
          (data.items ?? []).map((item) => ({
            value: item.value,
            usageCount: item.usageCount,
          })),
        )
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    },
    [scope],
  )

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      void fetchSuggestions(query)
    }, 200)
    return () => window.clearTimeout(timer)
  }, [open, query, fetchSuggestions])

  const addTag = useCallback(
    async (raw: string) => {
      const tag = normalizeTag(raw)
      if (!tag) return
      if (selectedKeys.has(tagKey(tag))) {
        setQuery("")
        return
      }
      onChange([...value, tag])
      setQuery("")
      if (allowCreate) {
        try {
          await fetch("/api/tag-suggestions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ scope, value: tag }),
          })
        } catch {
          // non-blocking
        }
      }
      void fetchSuggestions("")
    },
    [allowCreate, fetchSuggestions, onChange, scope, selectedKeys, value],
  )

  const removeTag = (tag: string) => {
    onChange(value.filter((item) => tagKey(item) !== tagKey(tag)))
  }

  const deleteFromStore = async (tag: string) => {
    if (!allowDeleteFromStore) return
    try {
      const response = await fetch("/api/tag-suggestions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ scope, value: tag }),
      })
      if (!response.ok) {
        toast.error("Could not remove suggestion.")
        return
      }
      setSuggestions((prev) => prev.filter((item) => tagKey(item.value) !== tagKey(tag)))
      toast.success("Removed from suggestions.")
    } catch {
      toast.error("Could not remove suggestion.")
    }
  }

  const filteredSuggestions = suggestions.filter(
    (item) => !selectedKeys.has(tagKey(item.value)),
  )

  return (
    <div className={cn("space-y-2", className)}>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface-2/80 px-2 py-0.5 text-xs text-foreground"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${tag}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 text-left text-sm text-muted-foreground shadow-sm transition hover:bg-accent/30"
          >
            {placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[16rem] p-0" align="start">
          <CommandPrimitive
            shouldFilter={false}
            className="flex flex-col overflow-hidden rounded-md"
          >
            <div className="flex items-center border-b px-3">
              <CommandPrimitive.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Type to search or add…"
                className="flex h-10 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && allowCreate && query.trim()) {
                    event.preventDefault()
                    void addTag(query)
                  }
                }}
              />
            </div>
            <CommandPrimitive.List className="max-h-56 overflow-y-auto p-1">
              {loading ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>
              ) : null}
              {!loading && filteredSuggestions.length === 0 && !query.trim() ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No suggestions yet. Type and press Enter.
                </p>
              ) : null}
              {filteredSuggestions.map((item) => (
                <CommandPrimitive.Item
                  key={item.value}
                  value={item.value}
                  onSelect={() => void addTag(item.value)}
                  className="group relative flex cursor-pointer select-none items-center justify-between rounded-sm px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground"
                >
                  <span className="truncate pr-6">{item.value}</span>
                  {allowDeleteFromStore ? (
                    <button
                      type="button"
                      data-no-select
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        void deleteFromStore(item.value)
                      }}
                      className="absolute right-1 rounded-sm p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                      aria-label={`Delete suggestion ${item.value}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </CommandPrimitive.Item>
              ))}
              {allowCreate &&
              query.trim() &&
              !filteredSuggestions.some(
                (item) => tagKey(item.value) === tagKey(query),
              ) ? (
                <CommandPrimitive.Item
                  value={`__create__${query}`}
                  onSelect={() => void addTag(query)}
                  className="cursor-pointer rounded-sm px-2 py-2 text-sm text-primary aria-selected:bg-accent"
                >
                  Add “{normalizeTag(query)}”
                </CommandPrimitive.Item>
              ) : null}
            </CommandPrimitive.List>
          </CommandPrimitive>
        </PopoverContent>
      </Popover>
    </div>
  )
}
