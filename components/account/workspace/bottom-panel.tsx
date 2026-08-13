"use client"

import {
  Archive,
  ArchiveRestore,
  FileText,
  MessageCircle,
  Send,
  Settings2,
  Trash2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { fmtDate, fmtTime } from "./format"
import type { BottomTab } from "./types"
import { useWorkspace } from "./workspace-context"

const TABS: { id: BottomTab; icon: typeof FileText; labelKey: "tabDesc" | "tabSettings" | "tabChat" }[] = [
  { id: "desc", icon: FileText, labelKey: "tabDesc" },
  { id: "settings", icon: Settings2, labelKey: "tabSettings" },
  { id: "chat", icon: MessageCircle, labelKey: "tabChat" },
]

export function DescriptionTab() {
  const { t, lang, selected, descDraft, setDescDraft, saveDescription } =
    useWorkspace()
  if (!selected) return null
  return (
    <div className="max-w-[720px]">
      <p className="text-[11px] font-semibold tracking-[1.4px] text-ws-accent">
        {t.descHeading}
      </p>
      <textarea
        value={descDraft}
        onChange={(e) => setDescDraft(e.target.value)}
        placeholder={t.descEmpty}
        rows={5}
        className="mt-2.5 w-full resize-y rounded-[10px] border border-white/10 bg-ws-control p-3 text-[14px] leading-relaxed text-ws-2 outline-none focus:border-ws-select"
      />
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <span className="rounded-full border border-white/[0.12] px-3 py-[5px] text-[12px] text-ws-3">
          {t.createdLabel} {fmtDate(selected.createdAt, lang)}
        </span>
        <span className="rounded-full border border-white/[0.12] px-3 py-[5px] text-[12px] text-ws-3">
          {t.updatedLabel} {fmtDate(selected.updatedAt, lang)}
        </span>
        <button
          type="button"
          onClick={saveDescription}
          className="ml-auto rounded-[9px] bg-ws-action px-4 py-2 text-[13px] text-white hover:bg-ws-action-hover"
        >
          {t.saveDescription}
        </button>
      </div>
    </div>
  )
}

export function SettingsTab() {
  const { t, selected, patchProject, setArchived, deleteProject } = useWorkspace()
  if (!selected) return null
  return (
    <div className="max-w-[640px]">
      <div className="flex items-center justify-between gap-4 py-3.5">
        <div>
          <p className="text-[14px] text-ws-1">{t.settingPauseTitle}</p>
          <p className="mt-1 text-[12px] text-ws-4">{t.settingPauseDesc}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={selected.isPaused}
          aria-label={t.settingPauseTitle}
          onClick={() =>
            void patchProject(selected.id, { isPaused: !selected.isPaused })
          }
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            selected.isPaused ? "bg-ws-action" : "bg-white/10",
          )}
        >
          <span
            className={cn(
              "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all",
              selected.isPaused ? "left-[23px]" : "left-[3px]",
            )}
          />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
        <button
          type="button"
          onClick={() => setArchived(selected, !selected.isArchived)}
          className="flex items-center gap-2 rounded-[9px] border border-white/10 px-4 py-2 text-[13px] text-ws-2 hover:bg-white/5"
        >
          {selected.isArchived ? (
            <ArchiveRestore className="h-4 w-4" />
          ) : (
            <Archive className="h-4 w-4" />
          )}
          {selected.isArchived ? t.mUnarchive : t.archiveProject}
        </button>
        <button
          type="button"
          onClick={() => deleteProject(selected.id)}
          className="flex items-center gap-2 rounded-[9px] border border-destructive/40 px-4 py-2 text-[13px] text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4" />
          {t.deleteProject}
        </button>
      </div>
    </div>
  )
}

export function ChatTab() {
  const { t, messages, draft, setDraft, sendMessage } = useWorkspace()
  return (
    <div className="flex h-full min-h-[160px] flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <p className="flex flex-1 items-center justify-center text-center text-[14px] text-ws-4">
            {t.chatEmpty}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderType === "client"
            const system = m.senderType === "system"
            return (
              <div
                key={m.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[72%] px-3.5 py-2.5 text-[13.5px] leading-snug",
                    mine
                      ? "rounded-[12px_12px_4px_12px] bg-ws-action text-white"
                      : system
                        ? "rounded-[12px] bg-white/[0.04] text-ws-3"
                        : "rounded-[12px_12px_12px_4px] bg-ws-hover text-ws-1",
                  )}
                >
                  {m.body}
                  <div
                    className={cn(
                      "mt-1 text-right text-[10.5px]",
                      mine ? "text-white/60" : "text-ws-4",
                    )}
                  >
                    {fmtTime(m.createdAt)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              sendMessage()
            }
          }}
          placeholder={t.chatPlaceholder}
          className="h-[42px] flex-1 rounded-[9px] border border-white/10 bg-ws-control px-3.5 text-[14px] text-ws-1 outline-none focus:border-ws-select"
        />
        <button
          type="button"
          onClick={sendMessage}
          aria-label={t.tabChat}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[9px] bg-ws-action text-white hover:bg-ws-action-hover"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

/** Нижняя панель: описание, настройки и чат проекта. */
export function BottomPanel({ onResize }: { onResize?: React.ReactNode }) {
  const { t, bottomTab, setBottomTab, openChat, selected } = useWorkspace()
  if (!selected) return null

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.07] bg-ws-panel">
      {onResize}
      <div className="flex shrink-0 flex-wrap gap-1.5 px-6 pt-3">
        {TABS.map((tab) => {
          const active = bottomTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() =>
                tab.id === "chat" ? openChat(selected.id) : setBottomTab(tab.id)
              }
              className={cn(
                "flex items-center gap-2 rounded-t-[9px] px-4 py-[9px] text-[13.5px]",
                active
                  ? "bg-ws-control text-ws-1"
                  : "bg-white/[0.03] text-ws-3 hover:text-ws-1",
              )}
            >
              <tab.icon className="h-[18px] w-[18px]" />
              {t[tab.labelKey]}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[0.07] px-6 py-5">
        {bottomTab === "desc" ? (
          <DescriptionTab />
        ) : bottomTab === "settings" ? (
          <SettingsTab />
        ) : (
          <ChatTab />
        )}
      </div>
    </section>
  )
}
