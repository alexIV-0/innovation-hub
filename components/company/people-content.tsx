"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { Section } from "@/components/admin/billing/fields"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { CompanyRole } from "@/lib/domain-types"

type Person = {
  userId: string
  email: string
  fullName: string
  companyRole: CompanyRole
  isActive: boolean
}

/**
 * «Сотрудники» — роли внутри компании.
 *
 * Заводить и переводить людей отсюда нельзя: перевод меняет плательщика и
 * снимает права, то есть задевает деньги и принадлежность, и живёт он в нашей
 * админке (план §6.6). Здесь — только роль в компании.
 */
export function CompanyPeople({ currentUserId }: { currentUserId: string }) {
  const { t } = useI18n()
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/company/people", { cache: "no-store" })
      if (res.ok) setPeople(await res.json())
      else toast.error(t.coLoadFailed)
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const changeRole = async (userId: string, companyRole: CompanyRole) => {
    setBusy(true)
    try {
      const res = await fetch("/api/company/people", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, companyRole }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(
          body.code === "last-owner"
            ? t.coPeopleLastOwner
            : body.code === "self"
              ? t.coPeopleSelfRole
              : t.coSaveFailed,
        )
        return
      }
      toast.success(t.coSaved)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t.coPeopleTitle} description={t.coPeopleSub}>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.coEmpty}</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {people.map((person) => {
            const isSelf = person.userId === currentUserId
            return (
              <li
                key={person.userId}
                className="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 flex-1 truncate text-sm">
                  {person.email}
                  {person.fullName ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {person.fullName}
                    </span>
                  ) : null}
                </span>
                {!person.isActive ? (
                  <Badge variant="secondary">{t.coPeopleSuspended}</Badge>
                ) : null}
                <Select
                  value={person.companyRole}
                  onValueChange={(value) =>
                    void changeRole(person.userId, value as CompanyRole)
                  }
                  disabled={busy || isSelf}
                >
                  <SelectTrigger className="h-9 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{t.coRoleMember}</SelectItem>
                    <SelectItem value="admin">{t.coRoleAdmin}</SelectItem>
                    <SelectItem value="owner">{t.coRoleOwner}</SelectItem>
                  </SelectContent>
                </Select>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
