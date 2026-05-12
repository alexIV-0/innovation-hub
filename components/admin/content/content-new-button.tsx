"use client"

import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAdminData } from "@/components/admin/data/admin-data-context"

export function ContentNewButton() {
  const { openCreate } = useAdminData()
  return (
    <Button className="gap-2 rounded-full" onClick={() => openCreate()}>
      <Plus className="h-4 w-4" />
      New
    </Button>
  )
}
