"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { avatarInitials, tf, type Dictionary } from "@/components/account/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

type MemberRole = "viewer" | "editor" | "full"

/** Роль смотрящего: владелец видит и меняет всё, полный доступ — не всё. */
type ViewerRole = MemberRole | "owner"

type Person = {
  userId: string
  email: string
  fullName: string
  role: MemberRole | "owner"
  /** Кто позвал этого человека: при делегировании звал не всегда владелец. */
  invitedBy?: string | null
  invitedByName?: string | null
}

const AVATAR_COLORS = [
  "#1a73e8",
  "#d93025",
  "#188038",
  "#e37400",
  "#9334e6",
  "#007b83",
  "#c5221f",
  "#1967d2",
]

function colorFor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function tokenize(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
}

function roleLabel(role: MemberRole, t: Dictionary): string {
  if (role === "full") return t.shareFull
  return role === "editor" ? t.shareEditor : t.shareViewer
}

function roleHint(role: MemberRole, t: Dictionary): string {
  if (role === "full") return t.shareFullHint
  return role === "editor" ? t.shareEditorHint : t.shareViewerHint
}

const ROLES: MemberRole[] = ["viewer", "editor", "full"]

/**
 * Может ли смотрящий распоряжаться доступом этого человека.
 *
 * Владелец — всеми. Полный доступ — читателями и редакторами, но не таким же
 * полным доступом: иначе двое приглашённых могли бы вычеркнуть друг друга из
 * проекта, который завёл не они. Те же правила стоят на сервере
 * (canManageMember в lib/project-access.ts) — здесь только показ.
 */
function canManage(viewerRole: ViewerRole, person: Person): boolean {
  if (person.role === "owner") return false
  if (viewerRole === "owner") return true
  if (viewerRole !== "full") return false
  return person.role !== "full"
}

function PersonAvatar({ name, email }: { name: string; email: string }) {
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white"
      style={{ backgroundColor: colorFor(email || name) }}
    >
      {avatarInitials(name, email)}
    </span>
  )
}

export function ShareDialog() {
  const { t, shareTarget, closeShareDialog } = useWorkspace()
  const open = shareTarget !== null
  const project = shareTarget

  const [draft, setDraft] = useState("")
  const [chips, setChips] = useState<string[]>([])
  const [inviteRole, setInviteRole] = useState<MemberRole>("viewer")
  const [owner, setOwner] = useState<Person | null>(null)
  const [members, setMembers] = useState<Person[]>([])
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [viewerRole, setViewerRole] = useState<ViewerRole>("owner")
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const taken = useMemo(() => {
    const set = new Set<string>()
    if (owner) set.add(owner.email.toLowerCase())
    for (const m of members) set.add(m.email.toLowerCase())
    for (const c of chips) set.add(c)
    return set
  }, [owner, members, chips])

  const reset = useCallback(() => {
    setDraft("")
    setChips([])
    setInviteRole("viewer")
    setOwner(null)
    setMembers([])
    setViewerUserId(null)
    setViewerRole("owner")
    setHint(null)
    setBusyId(null)
    setSending(false)
  }, [])

  useEffect(() => {
    if (!open || !project) {
      reset()
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${project.id}/members`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          toast.error(data.message ?? "Failed to load people")
          return
        }
        setViewerUserId(
          typeof data.viewerUserId === "string" ? data.viewerUserId : null,
        )
        setViewerRole(
          data.viewerRole === "full" ? "full" : "owner",
        )
        setOwner(
          data.owner
            ? {
                userId: data.owner.userId,
                email: data.owner.email,
                fullName: data.owner.fullName,
                role: "owner",
              }
            : null,
        )
        setMembers(
          Array.isArray(data.members)
            ? data.members.map(
                (m: {
                  userId: string
                  email: string
                  fullName: string
                  role: MemberRole
                  invitedBy?: string | null
                  invitedByName?: string | null
                }) => ({
                  userId: m.userId,
                  email: m.email,
                  fullName: m.fullName,
                  role: m.role,
                  invitedBy: m.invitedBy ?? null,
                  invitedByName: m.invitedByName ?? null,
                }),
              )
            : [],
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, project, reset])

  const commitTokens = useCallback(
    (raw: string): string => {
      const parts = tokenize(raw)
      if (parts.length === 0) return raw.trim()
      const leftover: string[] = []
      const next: string[] = []
      let message: string | null = null
      for (const part of parts) {
        if (!EMAIL_RE.test(part)) {
          leftover.push(part)
          message = t.shareInvalidEmail
          continue
        }
        if (taken.has(part) || next.includes(part) || chips.includes(part)) {
          message =
            owner && part === owner.email.toLowerCase()
              ? t.shareOwnerEmail
              : t.shareAlreadyAdded
          continue
        }
        next.push(part)
      }
      if (next.length) setChips((prev) => [...prev, ...next])
      setHint(message)
      return leftover.join(" ")
    },
    [chips, owner, t, taken],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !draft && chips.length) {
      event.preventDefault()
      setChips((prev) => prev.slice(0, -1))
      setHint(null)
      return
    }
    if (["Enter", "Tab", ",", ";", " "].includes(event.key)) {
      if (!draft.trim()) return
      event.preventDefault()
      const rest = commitTokens(draft)
      setDraft(rest)
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text")
    if (!/[,;\s]/.test(text)) return
    event.preventDefault()
    const rest = commitTokens(`${draft} ${text}`)
    setDraft(rest)
  }

  const send = async () => {
    if (!project) return
    const leftover: string[] = []
    const extra: string[] = []
    let message: string | null = null
    for (const part of tokenize(draft)) {
      if (!EMAIL_RE.test(part)) {
        leftover.push(part)
        message = t.shareInvalidEmail
        continue
      }
      if (owner && part === owner.email.toLowerCase()) {
        message = t.shareOwnerEmail
        continue
      }
      extra.push(part)
    }
    const unique = [
      ...new Set([...chips, ...extra].filter((email) => EMAIL_RE.test(email))),
    ]
    setDraft(leftover.join(" "))
    if (unique.length === 0) {
      setHint(message ?? (draft.trim() ? t.shareInvalidEmail : null))
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: unique, role: inviteRole }),
      })
      const data = await res.json().catch(() => ({}))
      const results = Array.isArray(data.results) ? data.results : []
      const ok = results.filter((r: { ok?: boolean }) => r.ok)
      const fail = results.filter((r: { ok?: boolean }) => !r.ok)
      for (const item of ok) {
        if (item.member) {
          setMembers((prev) => {
            if (prev.some((m) => m.userId === item.member.userId)) {
              return prev.map((m) =>
                m.userId === item.member.userId
                  ? { ...m, role: item.member.role }
                  : m,
              )
            }
            return [
              ...prev,
              {
                userId: item.member.userId,
                email: item.member.email,
                fullName: item.member.fullName,
                role: item.member.role,
              },
            ]
          })
        }
      }
      const okEmails = new Set(
        ok.map((r: { email?: string }) => r.email?.toLowerCase()).filter(Boolean),
      )
      setChips((prev) => prev.filter((email) => !okEmails.has(email)))
      if (ok.length && fail.length === 0) {
        const mailFail = ok.some((r: { mailOk?: boolean }) => r.mailOk === false)
        if (mailFail) toast.message(t.shareMailWarn)
        else toast.success(t.shareInviteSuccess)
        closeShareDialog()
      } else if (ok.length) {
        toast.message(t.shareInvitePartial)
        setHint(fail[0]?.message ?? t.shareInvitePartial)
      } else {
        toast.error(data.message ?? fail[0]?.message ?? "Share failed")
        setHint(data.message ?? fail[0]?.message ?? null)
      }
    } finally {
      setSending(false)
    }
  }

  const changeRole = async (person: Person, role: MemberRole) => {
    if (!project || person.role === "owner" || person.role === role) return
    setBusyId(person.userId)
    try {
      const res = await fetch(`/api/projects/${project.id}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: person.userId, role }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.message ?? "Failed")
        return
      }
      setMembers((prev) =>
        prev.map((m) => (m.userId === person.userId ? { ...m, role } : m)),
      )
    } finally {
      setBusyId(null)
    }
  }

  const removePerson = async (person: Person) => {
    if (!project || person.role === "owner") return
    setBusyId(person.userId)
    try {
      const res = await fetch(
        `/api/projects/${project.id}/members?userId=${encodeURIComponent(person.userId)}`,
        { method: "DELETE" },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.message ?? "Failed")
        return
      }
      setMembers((prev) => prev.filter((m) => m.userId !== person.userId))
    } finally {
      setBusyId(null)
    }
  }

  const hasPending = chips.length > 0 || EMAIL_RE.test(draft.trim().toLowerCase())

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeShareDialog()
      }}
    >
      <DialogContent className="gap-0 border-border/60 bg-ws-raised p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pb-1 pt-6">
          <DialogTitle className="pr-8 text-[18px] font-semibold tracking-tight text-ws-1">
            {t.shareTitle}
            {project ? ` «${project.name}»` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 pb-2 pt-4">
          <div
            className="flex min-h-[48px] items-start gap-2 rounded-xl border border-white/10 bg-ws-control px-2 py-1.5 focus-within:border-ws-select"
            onClick={() => inputRef.current?.focus()}
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 py-0.5">
              {chips.map((email) => (
                <span
                  key={email}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-white/10 py-0.5 pl-2 pr-1 text-[13px] text-ws-1"
                >
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    className="flex h-5 w-5 items-center justify-center rounded-full text-ws-3 hover:bg-white/10 hover:text-ws-1"
                    onClick={(e) => {
                      e.stopPropagation()
                      setChips((prev) => prev.filter((c) => c !== email))
                    }}
                    aria-label={t.shareRemove}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  if (hint) setHint(null)
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onBlur={() => {
                  if (!draft.trim()) return
                  const rest = commitTokens(draft)
                  setDraft(rest)
                }}
                placeholder={chips.length ? "" : t.shareAddPeoplePh}
                className="min-w-[140px] flex-1 bg-transparent py-1.5 text-[14px] text-ws-1 outline-none placeholder:text-ws-4"
                autoComplete="off"
                autoFocus
              />
            </div>
            <RoleMenu
              t={t}
              value={inviteRole}
              onChange={setInviteRole}
              disabled={sending}
            />
          </div>
          {hint ? (
            <p className="mt-2 text-[12px] text-destructive">{hint}</p>
          ) : (
            <p className="mt-2 text-[12px] text-ws-4">{t.shareAddPeople}</p>
          )}
        </div>

        <div className="px-6 pb-2 pt-3">
          <p className="mb-2 text-[13px] font-medium text-ws-2">
            {t.sharePeopleWithAccess}
          </p>
          {loading ? (
            <div className="flex items-center gap-2 py-4 text-[13px] text-ws-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.loading}
            </div>
          ) : (
            <ul className="max-h-[240px] space-y-1 overflow-y-auto pr-1">
              {owner ? (
                <li className="flex items-center gap-3 rounded-xl px-1 py-2">
                  <PersonAvatar name={owner.fullName} email={owner.email} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-medium text-ws-1">
                      {owner.fullName || owner.email}
                      {owner.userId === viewerUserId ? (
                        <span className="ml-1.5 text-[12px] font-normal text-ws-4">
                          ({t.shareYou})
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[12px] text-ws-4">{owner.email}</p>
                  </div>
                  <span className="shrink-0 px-2 text-[13px] text-ws-3">
                    {t.shareOwner}
                  </span>
                </li>
              ) : null}
              {members.map((person) => {
                const role: MemberRole =
                  person.role === "owner" ? "viewer" : person.role
                // «Добавил X» — только про чужие приглашения: строка, которую
                // смотрящий сам и создал, в подписи не нуждается.
                const addedBy =
                  person.invitedBy && person.invitedBy !== viewerUserId
                    ? person.invitedByName
                    : null
                return (
                  <li
                    key={person.userId}
                    className="flex items-center gap-3 rounded-xl px-1 py-2"
                  >
                    <PersonAvatar name={person.fullName} email={person.email} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium text-ws-1">
                        {person.fullName || person.email}
                        {person.userId === viewerUserId ? (
                          <span className="ml-1.5 text-[12px] font-normal text-ws-4">
                            ({t.shareYou})
                          </span>
                        ) : null}
                      </p>
                      <p className="truncate text-[12px] text-ws-4">
                        {person.email}
                        {addedBy
                          ? ` · ${tf(t.shareInvitedBy, { name: addedBy })}`
                          : ""}
                      </p>
                    </div>
                    {busyId === person.userId ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ws-4" />
                    ) : canManage(viewerRole, person) ? (
                      <MemberRoleMenu
                        t={t}
                        value={role}
                        onChange={(next) => void changeRole(person, next)}
                        onRemove={() => void removePerson(person)}
                      />
                    ) : (
                      // Роль показана, но не как кнопка: у смотрящего нет права
                      // её менять, и подсказка объясняет, почему.
                      <span
                        className="shrink-0 px-2 text-[13px] text-ws-3"
                        title={
                          person.userId === viewerUserId
                            ? t.shareManagedByOwner
                            : t.shareOwnerOnlyRole
                        }
                      >
                        {roleLabel(role, t)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t border-white/10 px-6 py-4">
          {hasPending ? (
            <Button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {sending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.sending}
                </>
              ) : (
                t.shareSend
              )}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={closeShareDialog}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {t.shareDone}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleMenu({
  t,
  value,
  onChange,
  disabled,
}: {
  t: Dictionary
  value: MemberRole
  onChange: (role: MemberRole) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="mt-0.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-ws-2 hover:bg-white/10 hover:text-ws-1 disabled:opacity-50"
          onClick={(e) => e.stopPropagation()}
        >
          {roleLabel(value, t)}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px] border-white/10 bg-ws-raised text-ws-1"
      >
        {ROLES.map((role) => (
          <RoleItem
            key={role}
            t={t}
            role={role}
            selected={value === role}
            onSelect={onChange}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MemberRoleMenu({
  t,
  value,
  onChange,
  onRemove,
}: {
  t: Dictionary
  value: MemberRole
  onChange: (role: MemberRole) => void
  onRemove: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-[13px] text-ws-2 hover:bg-white/10 hover:text-ws-1"
        >
          {roleLabel(value, t)}
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="min-w-[220px] border-white/10 bg-ws-raised text-ws-1"
      >
        {ROLES.map((role) => (
          <RoleItem
            key={role}
            t={t}
            role={role}
            selected={value === role}
            onSelect={onChange}
          />
        ))}
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          className="cursor-pointer text-destructive focus:bg-white/10 focus:text-destructive"
          onSelect={onRemove}
        >
          {t.shareRemove}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RoleItem({
  t,
  role,
  selected,
  onSelect,
}: {
  t: Dictionary
  role: MemberRole
  selected: boolean
  onSelect: (role: MemberRole) => void
}) {
  return (
    <DropdownMenuItem
      className="cursor-pointer flex-col items-start gap-0.5 py-2 focus:bg-white/10 focus:text-ws-1"
      onSelect={() => onSelect(role)}
    >
      <span className="flex w-full items-center gap-2">
        <span className="flex-1 font-medium">{roleLabel(role, t)}</span>
        {selected ? <Check className="h-3.5 w-3.5 text-ws-action" /> : null}
      </span>
      <span className="text-[12px] font-normal text-ws-4">
        {roleHint(role, t)}
      </span>
    </DropdownMenuItem>
  )
}
