"use client"

import { useEffect, useState } from "react"

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
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { useWorkspace } from "./workspace-context"

/** Диалоги ввода имени и подтверждения — замена нативным prompt() / confirm(). */
export function WorkspaceDialogs() {
  const { t, prompt, setPrompt, confirm, setConfirm } = useWorkspace()
  const [value, setValue] = useState("")

  useEffect(() => {
    if (prompt) setValue(prompt.initial)
  }, [prompt])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed || !prompt) return
    prompt.onSubmit(trimmed)
    setPrompt(null)
  }

  return (
    <>
      <Dialog open={!!prompt} onOpenChange={(open) => !open && setPrompt(null)}>
        {/* Описания нет — что вводить, говорит подпись у поля. См. ui/dialog.tsx. */}
        <DialogContent
          aria-describedby={undefined}
          className="border-border/60 bg-ws-raised sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="text-[16px] font-semibold text-ws-1">
              {prompt?.title}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ws-prompt" className="text-[12px] text-ws-3">
              {prompt?.label}
            </Label>
            <Input
              id="ws-prompt"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  submit()
                }
              }}
              className="h-10 rounded-[9px] border-white/10 bg-ws-control text-[14px] text-ws-1 focus-visible:border-ws-select focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="text-ws-2"
              onClick={() => setPrompt(null)}
            >
              {t.cancel}
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={!value.trim()}
              className="bg-ws-action text-white hover:bg-ws-action-hover"
            >
              {prompt?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => !open && setConfirm(null)}
      >
        <AlertDialogContent
          // Описание у подтверждения необязательное (ConfirmRequest#description);
          // когда его нет — отказываемся от него явно, как в ui/dialog.tsx.
          {...(confirm?.description
            ? {}
            : { "aria-describedby": undefined })}
          className="border-border/60 bg-ws-raised"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-ws-1">
              {confirm?.title}
            </AlertDialogTitle>
            {confirm?.description ? (
              <AlertDialogDescription className="text-ws-3">
                {confirm.description}
              </AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-ws-2 hover:bg-white/5 hover:text-ws-1">
              {t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirm?.onConfirm()}
              className={cn(
                confirm?.destructive
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-ws-action text-white hover:bg-ws-action-hover",
              )}
            >
              {confirm?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
