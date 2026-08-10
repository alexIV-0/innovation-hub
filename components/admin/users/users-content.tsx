"use client"

import { useMemo, useState } from "react"
import { Plus, Users } from "lucide-react"
import { useI18n } from "@/components/account/i18n"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { AdminUserRow } from "@/components/admin/admin-user-row"
import { useAdminData } from "@/components/admin/data/admin-data-context"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { SearchInput } from "@/components/admin/shared/search-input"

type Filter = "all" | "admins" | "members" | "suspended"

export function UsersContent() {
  const {
    users,
    loading,
    currentUserId,
    openCreateUser,
    openEditUser,
    patchUser,
    confirmDeleteUser,
  } = useAdminData()
  const { t: page } = useI18n()
  const t = useAdminI18n()

  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return users.filter((user) => {
      if (filter === "admins" && user.role !== "ADMIN") return false
      if (filter === "members" && user.role !== "USER") return false
      if (filter === "suspended" && user.isActive) return false
      if (!q) return true
      return (
        user.fullName.toLowerCase().includes(q) ||
        user.email.toLowerCase().includes(q)
      )
    })
  }, [users, query, filter])

  const counts = {
    all: users.length,
    admins: users.filter((u) => u.role === "ADMIN").length,
    members: users.filter((u) => u.role === "USER").length,
    suspended: users.filter((u) => !u.isActive).length,
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={page.adminPeopleEyebrow}
        title={page.adminPeopleTitle}
        description={page.adminPeopleDesc}
        actions={
          <Button onClick={openCreateUser} className="gap-2 rounded-full">
            <Plus className="h-4 w-4" />
            {page.adminPeopleNew}
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t.searchPeople}
        />
        <FilterPills value={filter} onChange={setFilter} counts={counts} />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users className="h-5 w-5" />}
          title={users.length === 0 ? t.noPeopleYet : t.nothingMatches}
          description={
            users.length === 0 ? t.peopleEmptyDesc : t.peopleNoMatchDesc
          }
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((user) => (
            <AdminUserRow
              key={user.id}
              user={user}
              isCurrent={user.id === currentUserId}
              onEdit={() => openEditUser(user)}
              onToggleRole={() =>
                void patchUser(user.id, {
                  role: user.role === "ADMIN" ? "USER" : "ADMIN",
                })
              }
              onToggleActive={() =>
                void patchUser(user.id, { isActive: !user.isActive })
              }
              onDelete={() => confirmDeleteUser(user)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type FilterPillsProps = {
  value: Filter
  onChange: (value: Filter) => void
  counts: Record<Filter, number>
}

function FilterPills({ value, onChange, counts }: FilterPillsProps) {
  const t = useAdminI18n()
  const items: { id: Filter; label: string }[] = [
    { id: "all", label: t.all },
    { id: "admins", label: t.filterAdmins },
    { id: "members", label: t.filterMembers },
    { id: "suspended", label: t.filterSuspended },
  ]
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full border border-border/70 bg-card/40 p-1">
      {items.map((item) => {
        const active = value === item.id
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
            <span
              className={`ml-1.5 rounded px-1.5 text-[10px] tabular-nums ${
                active
                  ? "bg-background/15 text-background"
                  : "bg-muted/50 text-muted-foreground"
              }`}
            >
              {counts[item.id]}
            </span>
          </button>
        )
      })}
    </div>
  )
}
