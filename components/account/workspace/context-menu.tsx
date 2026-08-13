"use client"

import {
  Archive,
  ArchiveRestore,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  FilePlus,
  FileText,
  FolderInput,
  FolderPlus,
  FolderUp,
  MessageCircle,
  Pencil,
  Scissors,
  Settings2,
  Share2,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

type MenuEntry =
  | { sep: true }
  | {
      sep?: false
      icon: LucideIcon
      label: string
      danger?: boolean
      onClick: () => void
    }

/**
 * Контекстное меню рабочей области.
 * Состав пунктов повторяет макет; часть действий пока не подключена
 * к API и показывает тост «Пока не подключено».
 */
export function WorkspaceContextMenu() {
  const ws = useWorkspace()
  const { menu, t } = ws

  if (!menu) return null

  const soon = ws.notImplemented
  let entries: MenuEntry[] = []

  if (menu.kind === "file" && menu.file) {
    const file = menu.file
    // Меню применяется ко всему выделению, если правый клик пришёлся по нему.
    const targets = ws.isSelected(file.id) ? ws.selection : [file]
    const many = targets.length > 1
    const suffix = many ? ` (${targets.length})` : ""

    entries = [
      // Скачивание и переименование осмысленны только для одного элемента.
      ...(!many && !file.isFolder
        ? [
            {
              icon: Download,
              label: t.mDownload,
              onClick: () => ws.downloadItem(file),
            } as MenuEntry,
          ]
        : []),
      ...(many
        ? []
        : [
            {
              icon: Pencil,
              label: t.mRename,
              onClick: () => ws.renameItem(file),
            } as MenuEntry,
          ]),
      { sep: true },
      {
        icon: Scissors,
        label: t.mCut + suffix,
        onClick: () => ws.putToClipboard("cut", targets),
      },
      {
        icon: Copy,
        label: t.mCopy + suffix,
        onClick: () => ws.putToClipboard("copy", targets),
      },
      {
        icon: FolderInput,
        label: t.mMove + suffix,
        onClick: () => ws.openMoveDialog(targets),
      },
      { sep: true },
      {
        icon: Trash2,
        label: t.mDelete + suffix,
        danger: true,
        onClick: () => ws.deleteItems(targets),
      },
    ]
  } else if (menu.kind === "empty") {
    const target = menu.target ?? ws.currentTarget
    entries = [
      {
        icon: FolderPlus,
        label: t.mNewFolder,
        onClick: () => ws.createFolder(target),
      },
      { icon: FilePlus, label: t.mNewText, onClick: () => ws.createTextFile(target) },
      { sep: true },
      {
        icon: Upload,
        label: t.mUploadFile,
        onClick: () => ws.triggerUpload(target),
      },
      {
        icon: FolderUp,
        label: t.mUploadFolder,
        onClick: () => ws.triggerFolderUpload(target),
      },
      // «Вставить» показываем только когда в буфере что-то есть.
      ...(ws.clipboard
        ? [
            { sep: true } as MenuEntry,
            {
              icon: ClipboardPaste,
              label: `${t.clipboardPaste} (${ws.clipboard.items.length})`,
              onClick: () => ws.pasteClipboard(target.folderPath),
            } as MenuEntry,
          ]
        : []),
    ]
  } else if (menu.kind === "project" && menu.project) {
    const project = menu.project
    entries = [
      {
        icon: Pencil,
        label: t.mRename,
        onClick: () => ws.renameProject(project),
      },
      ...(project.deletedAt
        ? [
            {
              icon: ArchiveRestore,
              label: t.mUnarchive,
              onClick: () => ws.restoreProject(project),
            } as MenuEntry,
          ]
        : project.sharedWithMe
          ? []
          : [
              {
                icon: Share2,
                label: t.mShare,
                onClick: () => ws.shareProject(project),
              } as MenuEntry,
            ]),
      {
        icon: ExternalLink,
        label: t.mOpenWindow,
        onClick: () =>
          window.open(
            `/account/projects?id=${project.id}`,
            "_blank",
            "noopener",
          ),
      },
      ...(project.deletedAt || project.sharedWithMe
        ? []
        : [
            {
              icon: project.isArchived ? ArchiveRestore : Archive,
              label: project.isArchived ? t.mUnarchive : t.mArchive,
              onClick: () => ws.setArchived(project, !project.isArchived),
            } as MenuEntry,
          ]),
      { sep: true },
      {
        icon: FileText,
        label: t.tabDesc,
        onClick: () => {
          ws.selectProject(project.id)
          ws.setBottomTab("desc")
        },
      },
      {
        icon: Settings2,
        label: t.tabSettings,
        onClick: () => {
          ws.selectProject(project.id)
          ws.setBottomTab("settings")
        },
      },
      {
        icon: MessageCircle,
        label: t.tabChat,
        onClick: () => ws.openChat(project.id),
      },
    ]
  }

  return (
    <div
      className="fixed inset-0 z-[120]"
      onClick={ws.closeMenu}
      onContextMenu={(e) => {
        e.preventDefault()
        ws.closeMenu()
      }}
    >
      <div
        role="menu"
        className="fixed flex min-w-[216px] flex-col gap-px rounded-[11px] border border-white/10 bg-ws-raised p-1.5 shadow-ws-menu"
        style={{ left: menu.x, top: menu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {entries.map((entry, i) =>
          entry.sep ? (
            <div key={`sep-${i}`} className="mx-1 my-[5px] h-px bg-white/[0.08]" />
          ) : (
            <button
              key={entry.label}
              type="button"
              role="menuitem"
              onClick={() => {
                ws.closeMenu()
                entry.onClick()
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.07]",
                entry.danger ? "text-destructive" : "text-ws-2",
              )}
            >
              <entry.icon className="h-[18px] w-[18px] shrink-0 opacity-85" />
              {entry.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
