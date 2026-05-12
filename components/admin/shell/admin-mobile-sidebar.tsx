"use client"

import { useState } from "react"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { AdminSidebar } from "./admin-sidebar"

type Props = {
  email: string
  fullName: string
}

export function AdminMobileSidebar({ email, fullName }: Props) {
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
        <SheetTitle className="sr-only">Admin navigation</SheetTitle>
        <AdminSidebar
          email={email}
          fullName={fullName}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
