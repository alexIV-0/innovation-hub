"use client"

import { useEffect, useRef, useState } from "react"
import { FileText, Loader2, Pencil, X } from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

/**
 * Редактор развёрнутого описания проекта — options/description.md.
 *
 * Показывается только там, где источник даёт descriptionMdUrl (сейчас это
 * админский «Конвейер»): описание пишет администрация, а не владелец проекта.
 *
 * Отрисовки markdown здесь пока нет — в проекте нет ни одной markdown-зависимости,
 * и выбор библиотеки ещё не сделан. Пока показываем исходный текст в моноширинном
 * виде: он читаемый, а поведение честное — видно ровно то, что лежит в файле.
 */
export function DescriptionMdEditor({ projectId }: { projectId: string }) {
  const { t } = useI18n()
  const { source } = useWorkspace()
  const buildUrl = source.descriptionMdUrl

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState("")
  const [draft, setDraft] = useState("")

  /** Гонка при быстром переключении проектов: ответ старого не должен перезаписать новый. */
  const requestedFor = useRef(projectId)

  useEffect(() => {
    if (!buildUrl) return
    requestedFor.current = projectId
    setEditing(false)
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(buildUrl(projectId))
        if (requestedFor.current !== projectId) return
        if (!res.ok) {
          setBody("")
          return
        }
        const data = await res.json()
        setBody(typeof data.body === "string" ? data.body : "")
      } finally {
        if (requestedFor.current === projectId) setLoading(false)
      }
    })()
  }, [buildUrl, projectId])

  if (!buildUrl) return null

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(buildUrl(projectId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.message ?? t.descSaveError)
        return
      }
      setBody(draft)
      setEditing(false)
      toast.success(t.descSaved)
    } catch {
      toast.error(t.descServerUnavailable)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 border-t border-white/[0.07] pt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[1.4px] text-ws-accent">
          <FileText className="h-3.5 w-3.5" />
          OPTIONS/DESCRIPTION.MD
        </p>
        {editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-[9px] border border-white/10 px-3 py-1.5 text-[12.5px] text-ws-3 hover:bg-white/5 disabled:opacity-60"
            >
              <X className="h-3.5 w-3.5" />
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-[9px] bg-ws-action px-3.5 py-1.5 text-[12.5px] text-white hover:bg-ws-action-hover disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {t.saveChanges}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(body)
              setEditing(true)
            }}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-[9px] border border-white/10 px-3 py-1.5 text-[12.5px] text-ws-2 hover:bg-white/5 disabled:opacity-60"
          >
            <Pencil className="h-3.5 w-3.5" />
            {body ? t.descEdit : t.descCreate}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6 text-ws-4">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={14}
          spellCheck={false}
          placeholder={t.descPlaceholder}
          className={cn(
            "mt-3 w-full resize-y rounded-[10px] border border-white/10 bg-ws-control p-3",
            "font-mono text-[13px] leading-relaxed text-ws-2 outline-none focus:border-ws-select",
          )}
        />
      ) : body ? (
        <pre className="mt-3 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-[10px] border border-white/[0.07] bg-ws-control p-3 font-mono text-[13px] leading-relaxed text-ws-2">
          {body}
        </pre>
      ) : (
        <p className="mt-3 text-[13px] text-ws-4">
          {t.descMdEmpty}
        </p>
      )}
    </section>
  )
}
