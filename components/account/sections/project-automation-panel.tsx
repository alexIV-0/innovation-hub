"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

/**
 * Renders the editable automation parameters from `options/options.json`
 * (entries flagged `exposedToSite: true`). The on/off switch for the
 * project itself lives on the project detail page's metadata card instead
 * — it works whether or not `folderState.json` exists yet, whereas this
 * panel only has something to show once automation has been fully set up.
 */

export type ProjectDriveFileDto = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  /** Present (possibly empty) on folders once their contents are loaded. */
  children?: ProjectDriveFileDto[]
}

export type ProjectFolderStateDto = {
  schemaVersion: number
  enabled: boolean
  disabledReason: string | null
  disabledAt: string | null
  lastActivityAt: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export type ExposedOptionDto = {
  path: string[]
  key: string
  label: string
  description: string | null
  type: "boolean" | "number" | "string"
  value: string | number | boolean
  /**
   * Тип контрола и его границы — как их задал автор графа в программе.
   * Пока панель рисует всё generic-полем и использует только границы; полный
   * набор контролов — docs/PROJECT_OPTIONS_PANEL.md §5.
   */
  controlType: string | null
  minValue: number | null
  maxValue: number | null
  step: number | null
  options: string[] | null
}

export type ProjectDriveDto = {
  files: ProjectDriveFileDto[]
  folderState: ProjectFolderStateDto | null
  options: ExposedOptionDto[]
}

type Props = {
  projectId: string
  options: ExposedOptionDto[]
}

function optionKey(option: ExposedOptionDto): string {
  return option.path.join("\u0000")
}

/** Draft holds booleans as-is; numbers and strings as raw input text. */
type DraftValue = string | boolean

function buildDraft(options: ExposedOptionDto[]): Record<string, DraftValue> {
  const draft: Record<string, DraftValue> = {}
  for (const option of options) {
    draft[optionKey(option)] =
      option.type === "boolean" ? (option.value as boolean) : String(option.value)
  }
  return draft
}

function isDirty(option: ExposedOptionDto, draft: DraftValue | undefined) {
  if (draft === undefined) return false
  return option.type === "boolean"
    ? draft !== option.value
    : draft !== String(option.value)
}

export function ProjectAutomationPanel({ projectId, options: initialOptions }: Props) {
  const [options, setOptions] = useState(initialOptions)
  const [draft, setDraft] = useState<Record<string, DraftValue>>(() =>
    buildDraft(initialOptions),
  )
  const [saving, setSaving] = useState(false)

  const dirtyOptions = options.filter((o) => isDirty(o, draft[optionKey(o)]))

  const onSaveOptions = async () => {
    const changes: { path: string[]; value: string | number | boolean }[] = []
    for (const option of dirtyOptions) {
      const raw = draft[optionKey(option)]
      if (option.type === "boolean") {
        changes.push({ path: option.path, value: raw === true })
        continue
      }
      if (option.type === "number") {
        const parsed = Number(String(raw).trim().replace(",", "."))
        if (!Number.isFinite(parsed)) {
          toast.error(`“${option.label}” must be a number.`)
          return
        }
        changes.push({ path: option.path, value: parsed })
        continue
      }
      changes.push({ path: option.path, value: String(raw) })
    }
    if (changes.length === 0) return

    setSaving(true)
    try {
      const response = await fetch(`/api/projects/${projectId}/drive/options`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      })
      const data = (await response.json().catch(() => null)) as
        | { options?: ExposedOptionDto[]; message?: string }
        | null
      if (!response.ok || !data?.options) {
        toast.error(data?.message ?? "Could not save options.")
        return
      }
      setOptions(data.options)
      setDraft(buildDraft(data.options))
      toast.success("Automation options saved.")
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setSaving(false)
    }
  }

  if (options.length === 0) return null

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        Automation parameters
      </h2>

      <div className="space-y-4 rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/40 px-5 py-4">
        <ul className="space-y-4">
          {options.map((option) => {
            const key = optionKey(option)
            const value = draft[key]
            return (
              <li
                key={key}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{option.label}</p>
                  {option.description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  ) : null}
                </div>
                {option.type === "boolean" ? (
                  <Switch
                    checked={value === true}
                    disabled={saving}
                    onCheckedChange={(checked) =>
                      setDraft((prev) => ({ ...prev, [key]: checked }))
                    }
                    aria-label={option.label}
                  />
                ) : (
                  <Input
                    value={typeof value === "string" ? value : ""}
                    disabled={saving}
                    // Границы из графа: сервер всё равно зажмёт значение, но
                    // подсказать их в поле дешевле, чем объяснять потом,
                    // почему сохранилось не то, что ввели.
                    type={option.type === "number" ? "number" : undefined}
                    inputMode={option.type === "number" ? "decimal" : "text"}
                    min={option.minValue ?? undefined}
                    max={option.maxValue ?? undefined}
                    step={option.step ?? undefined}
                    className="sm:w-56"
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                  />
                )}
              </li>
            )
          })}
        </ul>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={saving || dirtyOptions.length === 0}
            onClick={() => void onSaveOptions()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </section>
  )
}
