"use client"

import { useEffect, useState } from "react"
import { Check, Copy, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}

export function ConnectComputerDialog({ open, onOpenChange, onCreated }: Props) {
  const t = useAdminI18n()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setName("")
    setDescription("")
    setToken(null)
    setCopied(false)
    setSubmitting(false)
  }, [open])

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (trimmed.length < 1) {
      toast.error(t.remoteNameRequired)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/computers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || undefined,
        }),
      })
      const data = (await res.json()) as { message?: string; token?: string }
      if (!res.ok || !data.token) {
        toast.error(data.message ?? t.remoteCreateError)
        return
      }
      setToken(data.token)
      onCreated()
      toast.success(t.remoteCreated)
    } catch {
      toast.error(t.remoteCreateError)
    } finally {
      setSubmitting(false)
    }
  }

  const handleCopy = async () => {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      toast.success(t.remoteTokenCopied)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t.remoteTokenCopyError)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {token ? t.remoteTokenTitle : t.remoteConnectTitle}
          </DialogTitle>
          <DialogDescription>
            {token
              ? t.remoteTokenSaveNow
              : t.remoteConnectDesc}
          </DialogDescription>
        </DialogHeader>

        {token ? (
          <div className="space-y-3">
            <Label>{t.remoteBearerToken}</Label>
            <div className="flex gap-2">
              <Input readOnly value={token} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={() => void handleCopy()}>
                {copied ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="computer-name">{t.name}</Label>
              <Input
                id="computer-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.remoteNamePlaceholder}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="computer-desc">{t.remoteDescOptional}</Label>
              <Textarea
                id="computer-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.remoteDescPlaceholder}
                maxLength={500}
                rows={2}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              {t.done}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                {t.cancel}
              </Button>
              <Button type="button" onClick={() => void handleCreate()} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.creating}
                  </>
                ) : (
                  t.remoteConnect
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
