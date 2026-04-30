"use client"

import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { LogIn, LogOut, User } from "lucide-react"
import type { UserRole } from "@/lib/domain-types"

type SessionUser = {
  email: string
  role: UserRole
}

function splitEmail(email: string) {
  const i = email.indexOf("@")
  if (i === -1) {
    return { local: email, atDomain: "" as string }
  }
  return { local: email.slice(0, i), atDomain: `@${email.slice(i + 1)}` }
}

function emailAvatarLetter(email: string) {
  const { local } = splitEmail(email)
  const segment = local.trim() || email.trim()
  const match = segment.match(/\p{L}/u)
  if (match) {
    return match[0].toLocaleUpperCase()
  }
  const ch = segment[0]
  return ch ? ch.toLocaleUpperCase() : "?"
}

function UserMenu({ user, onSignOut }: { user: SessionUser; onSignOut: () => void }) {
  const { local, atDomain } = splitEmail(user.email)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto gap-2 rounded-full px-2 py-1.5 pr-3 hover:bg-accent"
          type="button"
        >
          <Avatar className="h-9 w-9 border border-border/60">
            <AvatarFallback className="bg-primary text-sm font-semibold text-primary-foreground">
              {emailAvatarLetter(user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-[9rem] truncate text-left text-sm font-medium text-foreground sm:inline">
            {local}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <div className="flex flex-col gap-0.5 px-2 py-1.5">
          <p className="truncate text-sm font-semibold leading-none">{local}</p>
          {atDomain ? (
            <p className="truncate text-xs text-muted-foreground">{atDomain}</p>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          )}
        </div>
        <DropdownMenuSeparator />
        {user.role === "ADMIN" ? (
          <DropdownMenuItem asChild>
            <Link href="/admin">Admin dashboard</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onSignOut}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" })
        const data = (await res.json()) as {
          authenticated?: boolean
          email?: string
          role?: UserRole
        }
        if (cancelled) return
        if (data.authenticated && data.email) {
          setUser({ email: data.email, role: data.role ?? "USER" })
        } else {
          setUser(null)
        }
      } catch {
        if (!cancelled) setUser(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pathname])

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" })
    setUser(null)
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <span className="font-display text-lg font-bold text-primary-foreground">IH</span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/about">About</Link>
            </Button>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/">Project</Link>
            </Button>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/contact">Contact</Link>
            </Button>
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground" asChild>
              <Link href="/admin">Admin</Link>
            </Button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {user === undefined ? (
            <div className="h-10 w-[7.5rem] animate-pulse rounded-md bg-muted/60" aria-hidden />
          ) : user ? (
            <UserMenu user={user} onSignOut={signOut} />
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                asChild
              >
                <Link href="/login">
                  <LogIn className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Sign In</span>
                </Link>
              </Button>
              <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90" asChild>
                <Link href="/register">
                  <User className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Register</span>
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
