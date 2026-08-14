"use client"

import {
  Archive,
  Folder,
  MessageCircle,
  Pause,
  Play,
  Users,
  Wrench,
} from "lucide-react"

import { tf } from "@/components/account/i18n"
import { cn } from "@/lib/utils"
import type { Project } from "./types"
import { useWorkspace } from "./workspace-context"

/** Карточка проекта в левой колонке: имя, статус обработки и чат. */
export function ProjectCard({
  project,
  groupName,
}: {
  project: Project
  groupName: string
}) {
  const {
    t,
    source,
    selectedId,
    selectProject,
    patchProject,
    openChat,
    openMenu,
    menu,
  } = useWorkspace()

  const selected = project.id === selectedId
  const isTool = groupName === "tools"
  const paused = project.isPaused
  const unread = project.unreadCount > 0
  /**
   * Архив показываем пометкой только там, где список не разделён по разделам:
   * в кабинете архивные лежат в своём разделе, и подпись была бы шумом, а в
   * админке они идут вперемешку с остальными и различать их нужно.
   */
  const showArchivedBadge = !source.splitByTab && project.isArchived
  /** Скольким расшарен. Ноль не показываем — большинство проектов личные. */
  const sharedWith = project.memberCount > 0 ? project.memberCount : null
  const isMenuTarget = menu?.kind === "project" && menu.project?.id === project.id
  const Icon = isTool ? Wrench : Folder

  const chatPill = (
    <button
      type="button"
      title={t.openChat}
      onClick={(e) => {
        e.stopPropagation()
        openChat(project.id)
      }}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] hover:brightness-125",
        unread
          ? "border-ws-select/50 bg-ws-select/[0.12] text-primary"
          : "border-white/[0.12] text-ws-3",
      )}
    >
      <MessageCircle className="h-3 w-3" />
      {t.chat}
      {unread ? (
        <span className="h-[7px] w-[7px] rounded-full bg-ws-select ring-2 ring-ws-select/30" />
      ) : null}
    </button>
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => selectProject(project.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          selectProject(project.id)
        }
      }}
      onContextMenu={(e) => openMenu("project", e, { project })}
      className={cn(
        "relative mb-[7px] cursor-pointer rounded-lg border",
        isMenuTarget
          ? "border-ws-accent/75"
          : selected
            ? "border-ws-select/55 bg-gradient-to-b from-ws-select/[0.22] to-ws-select/[0.06] shadow-ws-inset"
            : "border-white/10 hover:border-white/20",
        paused && !selected && "opacity-55",
      )}
    >
      {selected ? (
        <span className="absolute bottom-[9px] left-0 top-[7px] w-[3px] rounded-[3px] bg-ws-select" />
      ) : null}

      <div
        className={cn(
          "relative flex items-center gap-2.5 px-[5px] pt-2.5 leading-tight",
          // Нижняя строка не должна прилегать к верхней вплотную.
          isTool ? "pb-2.5" : "pb-[7px]",
        )}
      >
        <Icon
          className={cn(
            "h-5 w-5 shrink-0",
            selected ? "text-chart-3" : paused ? "text-ws-4" : "text-ws-3",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[16px]",
            selected ? "text-ws-1" : paused ? "text-ws-4" : "text-ws-2",
          )}
        >
          {project.name}
        </span>
        {sharedWith ? (
          <span
            title={tf(t.projectSharedWith, { users: sharedWith })}
            className="flex shrink-0 items-center gap-1 text-[11.5px] tabular-nums text-ws-5"
          >
            <Users className="h-3 w-3" />
            {sharedWith}
          </span>
        ) : null}
        {isTool ? chatPill : null}
      </div>

      {isTool ? null : (
        <div className="relative flex items-stretch justify-between gap-2 px-[5px] pb-[9px]">
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              title={paused ? t.resumeProject : t.pauseProject}
              onClick={(e) => {
                e.stopPropagation()
                void patchProject(project.id, { isPaused: !paused })
              }}
              className={cn(
                "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-[3px] text-[11px] hover:brightness-125",
                paused
                  ? "border-white/[0.12] text-ws-3"
                  : "border-ws-out/40 bg-ws-out/10 text-ws-out",
              )}
            >
              {paused ? (
                <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {paused ? t.statusPaused : t.statusActive}
            </button>
            {showArchivedBadge ? (
              <span
                title={t.archiveProject}
                className="flex shrink-0 items-center gap-1 rounded-full border border-white/[0.12] px-2 py-[3px] text-[11px] text-ws-4"
              >
                <Archive className="h-3 w-3" />
                {t.archiveTab}
              </span>
            ) : null}
          </div>
          {chatPill}
        </div>
      )}
    </div>
  )
}
