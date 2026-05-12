"use client"

import { useEffect, useState } from "react"
import { Eye, EyeOff, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { AdminUser } from "@/components/admin/admin-types"

type Mode = "create" | "edit"

export type UserDraft = {
  fullName: string
  email: string
  password: string
  role: "USER" | "ADMIN"
  isActive: boolean
}

const emptyDraft: UserDraft = {
  fullName: "",
  email: "",
  password: "",
  role: "USER",
  isActive: true,
}

type Props = {
  open: boolean
  mode: Mode
  initialUser?: AdminUser
  isSelf: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (draft: UserDraft, user?: AdminUser) => Promise<boolean>
}

export function AdminUserDialog({
  open,
  mode,
  initialUser,
  isSelf,
  onOpenChange,
  onSubmit,
}: Props) {
  const [draft, setDraft] = useState<UserDraft>(emptyDraft)
  const [submitting, setSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (!open) return
    setShowPassword(false)
    if (mode === "edit" && initialUser) {
      setDraft({
        fullName: initialUser.fullName,
        email: initialUser.email,
        password: "",
        role: initialUser.role,
        isActive: initialUser.isActive,
      })
    } else {
      setDraft(emptyDraft)
    }
  }, [open, mode, initialUser])

  const titleText = mode === "create" ? "New person" : "Edit person"
  const submitText = mode === "create" ? "Create account" : "Save changes"

  const handleSubmit = async () => {
    if (draft.fullName.trim().length < 2) {
      toast.error("Please enter a full name (at least 2 characters).")
      return
    }
    if (!draft.email.includes("@")) {
      toast.error("Please enter a valid email address.")
      return
    }
    if (mode === "create" && draft.password.length < 8) {
      toast.error("Password must be at least 8 characters.")
      return
    }
    if (mode === "edit" && draft.password.length > 0 && draft.password.length < 8) {
      toast.error("New password must be at least 8 characters.")
      return
    }

    setSubmitting(true)
    const ok = await onSubmit(draft, initialUser)
    setSubmitting(false)
    if (ok) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="max-w-lg"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{titleText}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Provision an account so this person can sign in immediately."
              : "Update the profile, rotate the password or change permissions."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="user-name">Full name</Label>
            <Input
              id="user-name"
              autoComplete="name"
              placeholder="Anna Petrova"
              value={draft.fullName}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, fullName: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-email">Email</Label>
            <Input
              id="user-email"
              type="email"
              autoComplete="email"
              placeholder="anna@example.com"
              value={draft.email}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, email: event.target.value }))
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="user-password">
              {mode === "create"
                ? "Password"
                : "New password (leave blank to keep)"}
            </Label>
            <div className="relative">
              <Input
                id="user-password"
                type={showPassword ? "text" : "password"}
                autoComplete={
                  mode === "create" ? "new-password" : "off"
                }
                placeholder={mode === "create" ? "At least 8 characters" : "••••••••"}
                value={draft.password}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    password: event.target.value,
                  }))
                }
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="user-role">Role</Label>
              <Select
                value={draft.role}
                onValueChange={(value) =>
                  setDraft((prev) => ({
                    ...prev,
                    role: value as "USER" | "ADMIN",
                  }))
                }
                disabled={isSelf && draft.role === "ADMIN"}
              >
                <SelectTrigger
                  id="user-role"
                  className="h-10 rounded-xl border-border/70 bg-card/40 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">Member</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
              {isSelf ? (
                <p className="text-[11px] text-muted-foreground">
                  You can&apos;t demote yourself.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="user-active">Status</Label>
              <div className="flex h-10 items-center gap-3 rounded-xl border border-border/70 bg-card/40 px-3">
                <Switch
                  id="user-active"
                  checked={draft.isActive}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({ ...prev, isActive: checked }))
                  }
                  disabled={isSelf}
                />
                <span className="text-sm text-foreground">
                  {draft.isActive ? "Active" : "Suspended"}
                </span>
              </div>
              {isSelf ? (
                <p className="text-[11px] text-muted-foreground">
                  You can&apos;t suspend yourself.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {submitText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
