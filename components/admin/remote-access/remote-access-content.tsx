"use client"

import { useCallback, useEffect, useState } from "react"
import { Monitor, Plus } from "lucide-react"
import { toast } from "sonner"
import { useI18n } from "@/components/account/i18n"
import { tf, useAdminI18n } from "@/components/admin/admin-dict"
import { Button } from "@/components/ui/button"
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog"
import { AdminPageHeader } from "@/components/admin/shell/admin-page-header"
import { EmptyState } from "@/components/admin/shared/empty-state"
import { LoadingBlock } from "@/components/admin/shared/loading-block"
import { AccessTokenRow } from "./access-token-row"
import { ConnectComputerDialog } from "./connect-computer-dialog"
import { RemoteAccessSubnav } from "./remote-access-subnav"
import { RotateTokenDialog } from "./rotate-token-dialog"
import type { AccessTokenDto } from "./types"

const POLL_MS = 20_000

export function RemoteAccessContent() {
  const { t: accountT } = useI18n()
  const t = useAdminI18n()
  const [tokens, setTokens] = useState<AccessTokenDto[]>([])
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const res = await fetch("/api/admin/machines")
      const data = (await res.json()) as {
        message?: string
        tokens?: AccessTokenDto[]
      }
      if (!res.ok) {
        if (!silent) toast.error(data.message ?? t.remoteLoadError)
        return
      }
      setTokens(data.tokens ?? [])
    } catch {
      if (!silent) toast.error(t.remoteLoadError)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [t.remoteLoadError])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = window.setInterval(() => void load(true), POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const revokeTarget = tokens.find((c) => c.id === revokeId)
  const rotateTarget = tokens.find((c) => c.id === rotateId)

  const handleRevoke = async () => {
    if (!revokeId) return
    try {
      const res = await fetch(`/api/admin/computers/${revokeId}`, {
        method: "DELETE",
      })
      const data = (await res.json()) as { message?: string }
      if (!res.ok) {
        toast.error(data.message ?? t.remoteRevokeError)
        return
      }
      toast.success(t.remoteRevoked)
      setRevokeId(null)
      await load(true)
    } catch {
      toast.error(t.remoteRevokeError)
    }
  }

  return (
    <div className="space-y-8">
      <AdminPageHeader
        eyebrow={accountT.adminRemoteEyebrow}
        title={accountT.adminRemoteTitle}
        description={accountT.adminRemoteDesc}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RemoteAccessSubnav />
            <Button
              onClick={() => setConnectOpen(true)}
              className="gap-2 rounded-full"
            >
              <Plus className="h-4 w-4" />
              {accountT.adminRemoteConnect}
            </Button>
          </div>
        }
      />

      {loading ? (
        <LoadingBlock />
      ) : tokens.length === 0 ? (
        <EmptyState
          icon={<Monitor className="h-5 w-5" />}
          title={accountT.adminRemoteEmptyTitle}
          description={accountT.adminRemoteEmptyDesc}
          action={
            <Button
              onClick={() => setConnectOpen(true)}
              className="mt-2 gap-2 rounded-full"
            >
              <Plus className="h-4 w-4" />
              {accountT.adminRemoteConnect}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {tokens.map((token) => (
            <AccessTokenRow
              key={`${token.kind}:${token.id}`}
              token={token}
              onRotateToken={() => setRotateId(token.id)}
              onRevoke={() => setRevokeId(token.id)}
            />
          ))}
        </div>
      )}

      <ConnectComputerDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onCreated={() => void load(true)}
      />

      <RotateTokenDialog
        open={rotateId != null}
        computerId={rotateId}
        computerName={rotateTarget?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) setRotateId(null)
        }}
      />

      <AdminConfirmDialog
        open={revokeId != null}
        onOpenChange={(open) => {
          if (!open) setRevokeId(null)
        }}
        title={t.remoteRevokeTitle}
        description={
          revokeTarget
            ? tf(t.remoteRevokeDesc, { name: revokeTarget.name })
            : undefined
        }
        confirmLabel={t.remoteRevokeConfirm}
        cancelLabel={t.cancel}
        destructive
        onConfirm={() => void handleRevoke()}
      />
    </div>
  )
}
