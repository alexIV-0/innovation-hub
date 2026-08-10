"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void | Promise<void>
  onOpenChange: (open: boolean) => void
}

export function AdminConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  const t = useAdminI18n()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel ?? t.cancel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => void onConfirm()}
            className={cn(
              destructive
                ? buttonVariants({ variant: "destructive" })
                : undefined,
            )}
          >
            {confirmLabel ?? t.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
