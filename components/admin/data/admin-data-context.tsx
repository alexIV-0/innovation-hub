"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AdminConfirmDialog } from "@/components/admin/admin-confirm-dialog"
import { AdminContentDialog } from "@/components/admin/admin-content-dialog"
import {
  AdminUserDialog,
  type UserDraft,
} from "@/components/admin/admin-user-dialog"
import type {
  AdminIdea,
  AdminUser,
  AdminVideo,
  ContentDraft,
  ContentItem,
  ContentKind,
} from "@/components/admin/admin-types"

type ConfirmState = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  action: () => Promise<void> | void
}

type DialogState =
  | { open: false }
  | {
      open: true
      mode: "create"
      kind: ContentKind
    }
  | {
      open: true
      mode: "edit"
      item: ContentItem
    }

type UserDialogState =
  | { open: false }
  | { open: true; mode: "create" }
  | { open: true; mode: "edit"; user: AdminUser }

type AdminDataContextValue = {
  currentUserId: string
  videos: AdminVideo[]
  ideas: AdminIdea[]
  users: AdminUser[]
  loading: boolean
  refresh: () => Promise<void>
  signOut: () => Promise<void>

  openCreate: (kind?: ContentKind) => void
  openEdit: (item: ContentItem) => void

  openCreateUser: () => void
  openEditUser: (user: AdminUser) => void

  patchVideo: (id: string, payload: Partial<AdminVideo>) => Promise<boolean>
  patchIdea: (id: string, payload: Partial<AdminIdea>) => Promise<boolean>
  reorder: (
    type: "videos" | "ideas",
    id: string,
    direction: "up" | "down",
  ) => Promise<void>
  patchUser: (id: string, payload: Partial<AdminUser>) => Promise<void>

  confirmDeleteVideo: (video: AdminVideo) => void
  confirmDeleteIdea: (idea: AdminIdea) => void
  confirmDeleteUser: (user: AdminUser) => void
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null)

export function useAdminData() {
  const context = useContext(AdminDataContext)
  if (!context) {
    throw new Error("useAdminData must be used inside AdminDataProvider")
  }
  return context
}

type ProviderProps = {
  currentUserId: string
  children: React.ReactNode
}

export function AdminDataProvider({ currentUserId, children }: ProviderProps) {
  const router = useRouter()

  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [ideas, setIdeas] = useState<AdminIdea[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)

  const [dialog, setDialog] = useState<DialogState>({ open: false })
  const [userDialog, setUserDialog] = useState<UserDialogState>({
    open: false,
  })
  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    title: "",
    action: () => {},
  })

  const refresh = useCallback(async () => {
    try {
      const [vRes, iRes, uRes] = await Promise.all([
        fetch("/api/admin/videos", { cache: "no-store" }),
        fetch("/api/admin/ideas", { cache: "no-store" }),
        fetch("/api/admin/users", { cache: "no-store" }),
      ])
      if (!vRes.ok || !iRes.ok || !uRes.ok) throw new Error("load")
      const [vData, iData, uData] = await Promise.all([
        vRes.json(),
        iRes.json(),
        uRes.json(),
      ])
      setVideos(vData)
      setIdeas(iData)
      setUsers(uData)
    } catch {
      toast.error("Could not load admin data. Please refresh.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const submitContent = useCallback(
    async (draft: ContentDraft, item?: ContentItem) => {
      const isEdit = Boolean(item)
      const targetBase =
        draft.kind === "video" ? "/api/admin/videos" : "/api/admin/ideas"

      const fields = {
        title: draft.title,
        description: draft.description,
        thumbnail: draft.thumbnail,
        videoUrl: draft.videoUrl,
        duration: draft.duration,
        tags: draft.tags,
      }

      // Type conversion: kind changed during edit → create record in the new
      // table preserving fields + isPublished, then delete the original. We do
      // this client-side because /api/admin/{videos,ideas} are separate
      // resources backed by separate tables.
      if (isEdit && item && item.kind !== draft.kind) {
        const sourceBase =
          item.kind === "video" ? "/api/admin/videos" : "/api/admin/ideas"

        const createRes = await fetch(targetBase, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fields,
            isPublished: item.data.isPublished,
          }),
        })
        if (!createRes.ok) {
          toast.error("Could not switch type. Original is unchanged.")
          return false
        }

        const deleteRes = await fetch(`${sourceBase}/${item.data.id}`, {
          method: "DELETE",
        })
        if (!deleteRes.ok) {
          toast.error(
            "New record created, but couldn't remove the old one. Delete it manually.",
          )
          await refresh()
          return true
        }

        toast.success(
          `Converted to ${draft.kind === "video" ? "video" : "idea"}.`,
        )
        await refresh()
        return true
      }

      const payload: Record<string, unknown> = { ...fields }
      if (!isEdit) payload.isPublished = true

      const response = await fetch(
        isEdit ? `${targetBase}/${item!.data.id}` : targetBase,
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        toast.error(
          isEdit
            ? "Could not save changes."
            : `Could not add ${draft.kind}.`,
        )
        return false
      }

      toast.success(
        isEdit
          ? `${draft.kind === "video" ? "Video" : "Idea"} updated.`
          : `${draft.kind === "video" ? "Video" : "Idea"} added.`,
      )
      await refresh()
      return true
    },
    [refresh],
  )

  const patchVideo = useCallback(
    async (id: string, payload: Partial<AdminVideo>) => {
      const response = await fetch(`/api/admin/videos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        toast.error("Could not update the video.")
        return false
      }
      await refresh()
      return true
    },
    [refresh],
  )

  const patchIdea = useCallback(
    async (id: string, payload: Partial<AdminIdea>) => {
      const response = await fetch(`/api/admin/ideas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        toast.error("Could not update the idea.")
        return false
      }
      await refresh()
      return true
    },
    [refresh],
  )

  const reorder = useCallback(
    async (type: "videos" | "ideas", id: string, direction: "up" | "down") => {
      const response = await fetch(`/api/admin/${type}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, direction }),
      })
      if (!response.ok) {
        toast.error("Could not change the order.")
        return
      }
      await refresh()
    },
    [refresh],
  )

  const deleteEntity = useCallback(
    async (type: "videos" | "ideas", id: string) => {
      const response = await fetch(`/api/admin/${type}/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        toast.error("Could not delete.")
        return
      }
      toast.success(type === "videos" ? "Video deleted." : "Idea deleted.")
      await refresh()
    },
    [refresh],
  )

  const submitUser = useCallback(
    async (draft: UserDraft, user?: AdminUser) => {
      const isEdit = Boolean(user)

      const payload: Record<string, unknown> = {
        fullName: draft.fullName.trim(),
        email: draft.email.trim().toLowerCase(),
        role: draft.role,
        isActive: draft.isActive,
      }
      if (draft.password.length > 0) {
        payload.password = draft.password
      } else if (!isEdit) {
        toast.error("Password is required.")
        return false
      }

      const response = await fetch(
        isEdit ? `/api/admin/users/${user!.id}` : "/api/admin/users",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )

      if (!response.ok) {
        let message = isEdit
          ? "Could not save the user."
          : "Could not create the user."
        try {
          const data = await response.json()
          if (data?.message) message = data.message
        } catch {}
        toast.error(message)
        return false
      }

      toast.success(isEdit ? "User updated." : "User created.")
      await refresh()
      return true
    },
    [refresh],
  )

  const patchUser = useCallback(
    async (id: string, payload: Partial<AdminUser>) => {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        toast.error("Could not update the user.")
        return
      }
      await refresh()
    },
    [refresh],
  )

  const deleteUser = useCallback(
    async (id: string) => {
      const response = await fetch(`/api/admin/users/${id}`, {
        method: "DELETE",
      })
      if (!response.ok) {
        toast.error("Could not delete the user.")
        return
      }
      toast.success("User deleted.")
      await refresh()
    },
    [refresh],
  )

  const askConfirm = useCallback((state: Omit<ConfirmState, "open">) => {
    setConfirm({ ...state, open: true })
  }, [])

  const closeConfirm = useCallback((open: boolean) => {
    setConfirm((prev) => ({ ...prev, open }))
  }, [])

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }, [router])

  const value = useMemo<AdminDataContextValue>(
    () => ({
      currentUserId,
      videos,
      ideas,
      users,
      loading,
      refresh,
      signOut,
      openCreate: (kind = "video") =>
        setDialog({ open: true, mode: "create", kind }),
      openEdit: (item) => setDialog({ open: true, mode: "edit", item }),
      openCreateUser: () => setUserDialog({ open: true, mode: "create" }),
      openEditUser: (user) =>
        setUserDialog({ open: true, mode: "edit", user }),
      patchVideo,
      patchIdea,
      reorder,
      patchUser,
      confirmDeleteVideo: (video) =>
        askConfirm({
          title: "Delete this video?",
          description: `“${video.title}” will be removed permanently.`,
          confirmLabel: "Delete video",
          destructive: true,
          action: () => deleteEntity("videos", video.id),
        }),
      confirmDeleteIdea: (idea) =>
        askConfirm({
          title: "Delete this idea?",
          description: `“${idea.title}” will be removed permanently.`,
          confirmLabel: "Delete idea",
          destructive: true,
          action: () => deleteEntity("ideas", idea.id),
        }),
      confirmDeleteUser: (user) =>
        askConfirm({
          title: "Delete this account?",
          description: `${user.fullName || user.email} will lose access immediately.`,
          confirmLabel: "Delete account",
          destructive: true,
          action: () => deleteUser(user.id),
        }),
    }),
    [
      currentUserId,
      videos,
      ideas,
      users,
      loading,
      refresh,
      signOut,
      patchVideo,
      patchIdea,
      reorder,
      patchUser,
      askConfirm,
      deleteEntity,
      deleteUser,
    ],
  )

  const dialogProps = (() => {
    if (!dialog.open) {
      return {
        open: false,
        mode: "create" as const,
        initialKind: "video" as ContentKind,
        initialItem: undefined,
      }
    }
    if (dialog.mode === "create") {
      return {
        open: true,
        mode: "create" as const,
        initialKind: dialog.kind,
        initialItem: undefined,
      }
    }
    return {
      open: true,
      mode: "edit" as const,
      initialKind: dialog.item.kind,
      initialItem: dialog.item,
    }
  })()

  return (
    <AdminDataContext.Provider value={value}>
      {children}

      <AdminContentDialog
        open={dialogProps.open}
        mode={dialogProps.mode}
        initialKind={dialogProps.initialKind}
        initialItem={dialogProps.initialItem}
        onOpenChange={(open) => {
          if (!open) setDialog({ open: false })
        }}
        onSubmit={submitContent}
      />

      <AdminUserDialog
        open={userDialog.open}
        mode={userDialog.open ? userDialog.mode : "create"}
        initialUser={
          userDialog.open && userDialog.mode === "edit"
            ? userDialog.user
            : undefined
        }
        isSelf={
          userDialog.open && userDialog.mode === "edit"
            ? userDialog.user.id === currentUserId
            : false
        }
        onOpenChange={(open) => {
          if (!open) setUserDialog({ open: false })
        }}
        onSubmit={submitUser}
      />

      <AdminConfirmDialog
        open={confirm.open}
        title={confirm.title}
        description={confirm.description}
        confirmLabel={confirm.confirmLabel}
        destructive={confirm.destructive}
        onConfirm={async () => {
          await confirm.action()
          closeConfirm(false)
        }}
        onOpenChange={closeConfirm}
      />
    </AdminDataContext.Provider>
  )
}
