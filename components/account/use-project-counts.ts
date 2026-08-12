"use client"

import { useCallback, useEffect, useState } from "react"

import { PROJECTS_CHANGED_EVENT } from "@/components/account/workspace/workspace-context"
import type { ProjectTab } from "@/components/account/workspace/workspace-context"

type Counts = Record<ProjectTab, number>

const EMPTY: Counts = { projects: 0, shared: 0, tools: 0, archive: 0, trash: 0 }

/**
 * Числа для разделов бокового меню.
 *
 * Меню живёт в шелле — выше страницы проектов, поэтому её контекст ему недоступен
 * и список приходится запрашивать своим запросом. Чтобы числа не отставали после
 * создания или архивации, страница шлёт событие `PROJECTS_CHANGED_EVENT`.
 */
export function useProjectCounts() {
  const [counts, setCounts] = useState<Counts>(EMPTY)

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/projects")
      if (!res.ok) return
      const data = await res.json()
      const acc: Counts = { ...EMPTY }
      for (const raw of data.projects ?? []) {
        const p = raw as { isArchived?: boolean; groupName?: string }
        if (p.isArchived) acc.archive += 1
        else if (p.groupName === "shared") acc.shared += 1
        else if (p.groupName === "tools") acc.tools += 1
        else acc.projects += 1
      }
      setCounts(acc)
    } catch {
      // счётчики не критичны — молча оставляем прежние
    }
  }, [])

  useEffect(() => {
    void load()
    const onChange = () => void load()
    window.addEventListener(PROJECTS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, onChange)
  }, [load])

  return counts
}
