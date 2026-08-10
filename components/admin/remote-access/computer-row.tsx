"use client"

import {
  KeyRound,
  MoreHorizontal,
  Trash2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { cn } from "@/lib/utils"
import type { RemoteComputerDto } from "./types"

type Props = {
  computer: RemoteComputerDto
  onRotateToken: () => void
  onRevoke: () => void
}

function formatHeartbeat(value: string | null) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
  } catch {
    return "—"
  }
}

export function ComputerRow({ computer, onRotateToken, onRevoke }: Props) {
  const t = useAdminI18n()
  const statusLabel: Record<RemoteComputerDto["status"], string> = {
    idle: t.idle,
    busy: t.busy,
    error: t.error,
  }

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        <span
          className={cn(
            "relative flex h-3 w-3",
            computer.online && "after:absolute after:inset-0 after:animate-ping after:rounded-full after:bg-emerald-400/60",
          )}
          title={computer.online ? t.online : t.offline}
        >
          <span
            className={cn(
              "relative inline-flex h-3 w-3 rounded-full",
              computer.online ? "bg-emerald-400" : "bg-muted-foreground/40",
            )}
          />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{computer.name}</p>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              computer.online
                ? "border-emerald-500/40 text-emerald-300"
                : "text-muted-foreground",
            )}
          >
            {computer.online ? t.online : t.offline}
          </Badge>
          {computer.online ? (
            <Badge
              variant="secondary"
              className={cn(
                "text-[10px]",
                computer.status === "error" && "bg-destructive/15 text-destructive",
                computer.status === "busy" && "bg-amber-500/15 text-amber-200",
              )}
            >
              {statusLabel[computer.status]}
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">
          {computer.currentProjectName
            ? tf(t.remoteProject, { name: computer.currentProjectName })
            : computer.currentProjectId
              ? tf(t.remoteProject, { name: computer.currentProjectId })
              : t.remoteNoProject}
          {computer.currentTask ? ` · ${computer.currentTask}` : ""}
        </p>
      </div>

      <p className="hidden text-xs text-muted-foreground lg:block">
        {t.remoteHeartbeat}
        {formatHeartbeat(computer.lastHeartbeatAt)}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">{t.actions}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onRotateToken}>
            <KeyRound className="h-4 w-4" />
            {t.remoteRotateToken}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onRevoke}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            {t.remoteRevokeConfirm}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
