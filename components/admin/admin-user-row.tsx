"use client"

import {
  MoreHorizontal,
  Pencil,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserCheck,
  UserX,
} from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { AdminUser } from "./admin-types"

type Props = {
  user: AdminUser
  isCurrent: boolean
  onEdit: () => void
  onToggleRole: () => void
  onToggleActive: () => void
  onDelete: () => void
}

function avatarLetter(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "?"
  const match = trimmed.match(/\p{L}/u)
  return (match ? match[0] : trimmed[0]).toLocaleUpperCase()
}

function formatDate(value: string) {
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return ""
  }
}

export function AdminUserRow({
  user,
  isCurrent,
  onEdit,
  onToggleRole,
  onToggleActive,
  onDelete,
}: Props) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(event) => {
        const target = event.target as HTMLElement
        if (target.closest("[data-no-edit]")) return
        onEdit()
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onEdit()
        }
      }}
      className="flex cursor-pointer items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-card/70"
    >
      <Avatar className="h-10 w-10 border border-border/60">
        <AvatarFallback className="bg-primary/15 text-sm font-semibold text-primary">
          {avatarLetter(user.fullName || user.email)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">
            {user.fullName || user.email}
          </p>
          {isCurrent ? (
            <Badge variant="outline" className="text-[10px]">
              You
            </Badge>
          ) : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">{user.email}</p>
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        {user.role === "ADMIN" ? (
          <Badge className="gap-1 border-transparent bg-primary/15 text-primary hover:bg-primary/15">
            <ShieldCheck className="h-3 w-3" />
            Admin
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            Member
          </Badge>
        )}
        {user.isActive ? (
          <Badge className="gap-1 border-transparent bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/15">
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1 text-muted-foreground">
            Suspended
          </Badge>
        )}
      </div>

      <p className="hidden text-xs text-muted-foreground md:block">
        Joined {formatDate(user.createdAt)}
      </p>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            data-no-edit
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="h-4 w-4" />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onToggleRole}
            disabled={isCurrent && user.role === "ADMIN"}
          >
            {user.role === "ADMIN" ? (
              <>
                <ShieldOff className="h-4 w-4" />
                Remove admin
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                Make admin
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleActive} disabled={isCurrent}>
            {user.isActive ? (
              <>
                <UserX className="h-4 w-4" />
                Suspend
              </>
            ) : (
              <>
                <UserCheck className="h-4 w-4" />
                Reactivate
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            disabled={isCurrent}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            Delete account
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
