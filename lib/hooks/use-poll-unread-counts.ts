"use client"

import { useEffect, useRef } from "react"

/**
 * Polls `/api/projects/unread-counts` on an interval and hands the latest
 * `{ projectId: count }` map to `apply`, so project list pages can keep
 * their chat badges fresh without a full page reload. `apply` is read via a
 * ref so callers can pass an inline closure without resetting the interval
 * on every render.
 */
export function usePollUnreadCounts(
  apply: (counts: Record<string, number>) => void,
  intervalMs = 20000,
) {
  const applyRef = useRef(apply)
  useEffect(() => {
    applyRef.current = apply
  }, [apply])

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const response = await fetch("/api/projects/unread-counts", {
          credentials: "same-origin",
        })
        if (!response.ok || cancelled) return
        const data = (await response.json().catch(() => null)) as {
          counts?: Record<string, number>
        } | null
        if (data?.counts && !cancelled) applyRef.current(data.counts)
      } catch {
        // Silent — retried on the next tick.
      }
    }

    const interval = window.setInterval(() => void tick(), intervalMs)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [intervalMs])
}
