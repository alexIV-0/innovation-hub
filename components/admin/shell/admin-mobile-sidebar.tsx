"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { AdminSidebar } from "./admin-sidebar"

type Props = {
  email: string
  fullName: string
}

export function AdminMobileSidebar({ email, fullName }: Props) {
  const t = useAdminI18n()
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label={t.openNav}
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-72 border-border/70 bg-[hsl(var(--surface-1))]/95 p-0"
      >
        <SheetTitle className="sr-only">{t.adminNav}</SheetTitle>
        <AdminSidebar
          email={email}
          fullName={fullName}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
