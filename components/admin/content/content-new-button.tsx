"use client"

import { Plus } from "lucide-react"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { useAdminData } from "@/components/admin/data/admin-data-context"

export function ContentNewButton() {
  const { openCreate } = useAdminData()
  const t = useAdminI18n()
  return (
    <Button className="gap-2 rounded-full" onClick={() => openCreate()}>
      <Plus className="h-4 w-4" />
      {t.new}
    </Button>
  )
}
