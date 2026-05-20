"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import type { UserRole } from "@/lib/domain-types"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { AccountSidebar } from "./account-sidebar"

type Props = {
  email: string
  fullName: string
  role: UserRole
}

export function AccountMobileSidebar({ email, fullName, role }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 border-border/70 bg-[hsl(var(--surface-1))]/95 p-0"
      >
        <SheetTitle className="sr-only">Account navigation</SheetTitle>
        <AccountSidebar
          email={email}
          fullName={fullName}
          role={role}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
