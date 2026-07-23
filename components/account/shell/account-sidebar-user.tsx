"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, LogOut } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type Props = {
  email: string
  fullName: string
}

function avatarLetter(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return "?"
  const match = trimmed.match(/\p{L}/u)
  return (match ? match[0] : trimmed[0]).toLocaleUpperCase()
}

export function AccountSidebarUser({ email, fullName }: Props) {
  const router = useRouter()
  const [signingOut, setSigningOut] = useState(false)
  const display = fullName.trim() || email

  const signOut = async () => {
    setSigningOut(true)
    try {
      await fetch("/api/auth/signout", { method: "POST" })
      router.push("/login")
      router.refresh()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border/60 bg-white/[0.03] p-2.5 transition-colors hover:border-border">
      <Avatar className="h-9 w-9 border border-primary/25">
        <AvatarFallback className="bg-gradient-to-b from-primary/25 to-primary/10 text-sm font-semibold text-primary">
          {avatarLetter(display)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{display}</p>
        <p className="truncate text-[11px] text-muted-foreground">{email}</p>
      </div>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={signOut}
              disabled={signingOut}
            >
              {signingOut ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              <span className="sr-only">Sign out</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Sign out</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}
