"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Film,
  Lightbulb,
  Loader2,
  LogOut,
  Plus,
  Search,
  Users,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AdminConfirmDialog } from "./admin-confirm-dialog"
import { AdminIdeaCard } from "./admin-idea-card"
import { AdminIdeaDialog } from "./admin-idea-dialog"
import { AdminUserRow } from "./admin-user-row"
import { AdminVideoCard } from "./admin-video-card"
import { AdminVideoDialog } from "./admin-video-dialog"
import type {
  AdminIdea,
  AdminUser,
  AdminVideo,
  IdeaDraft,
  VideoDraft,
} from "./admin-types"

type ConfirmState = {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  destructive?: boolean
  action: () => Promise<void> | void
}

const initialConfirm: ConfirmState = {
  open: false,
  title: "",
  description: "",
  action: () => {},
}

type StatCardProps = {
  label: string
  value: number
  icon: React.ReactNode
  accent: string
}

function StatCard({ label, value, icon, accent }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div
          className={`flex h-9 w-9 items-center justify-center rounded-xl ${accent}`}
        >
          {icon}
        </div>
      </div>
      <p className="mt-2 font-display text-3xl font-bold text-foreground">
        {value}
      </p>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="space-y-1">
        <p className="font-display text-lg font-semibold text-foreground">
          {title}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

export function AdminDashboard({ currentUserId }: { currentUserId: string }) {
  const router = useRouter()

  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [ideas, setIdeas] = useState<AdminIdea[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [initialLoading, setInitialLoading] = useState(true)

  const [videoDialog, setVideoDialog] = useState<{
    open: boolean
    mode: "create" | "edit"
    video?: AdminVideo
  }>({ open: false, mode: "create" })

  const [ideaDialog, setIdeaDialog] = useState<{
    open: boolean
    mode: "create" | "edit"
    idea?: AdminIdea
  }>({ open: false, mode: "create" })

  const [confirm, setConfirm] = useState<ConfirmState>(initialConfirm)

  const [videoQuery, setVideoQuery] = useState("")
  const [ideaQuery, setIdeaQuery] = useState("")
  const [userQuery, setUserQuery] = useState("")

  const sortedVideos = useMemo(
    () => [...videos].sort((a, b) => a.sortOrder - b.sortOrder),
    [videos],
  )
  const sortedIdeas = useMemo(
    () => [...ideas].sort((a, b) => a.sortOrder - b.sortOrder),
    [ideas],
  )

  const filteredVideos = useMemo(() => {
    const q = videoQuery.trim().toLowerCase()
    if (!q) return sortedVideos
    return sortedVideos.filter(
      (v) =>
        v.title.toLowerCase().includes(q) ||
        v.category.toLowerCase().includes(q),
    )
  }, [sortedVideos, videoQuery])

  const filteredIdeas = useMemo(() => {
    const q = ideaQuery.trim().toLowerCase()
    if (!q) return sortedIdeas
    return sortedIdeas.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q),
    )
  }, [sortedIdeas, ideaQuery])

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter(
      (u) =>
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q),
    )
  }, [users, userQuery])

  const loadAll = async () => {
    try {
      const [videosRes, ideasRes, usersRes] = await Promise.all([
        fetch("/api/admin/videos"),
        fetch("/api/admin/ideas"),
        fetch("/api/admin/users"),
      ])

      if (!videosRes.ok || !ideasRes.ok || !usersRes.ok) {
        throw new Error("load")
      }

      const [videosData, ideasData, usersData] = await Promise.all([
        videosRes.json(),
        ideasRes.json(),
        usersRes.json(),
      ])

      setVideos(videosData)
      setIdeas(ideasData)
      setUsers(usersData)
    } catch {
      toast.error("Could not load admin data. Please refresh.")
    } finally {
      setInitialLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitVideo = async (
    draft: VideoDraft,
    id?: string,
  ): Promise<boolean> => {
    const isEdit = Boolean(id)
    const response = await fetch(
      isEdit ? `/api/admin/videos/${id}` : "/api/admin/videos",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? draft : { ...draft, isPublished: true }),
      },
    )

    if (!response.ok) {
      toast.error(isEdit ? "Could not save changes." : "Could not add video.")
      return false
    }

    toast.success(isEdit ? "Video updated." : "Video added.")
    await loadAll()
    return true
  }

  const submitIdea = async (
    draft: IdeaDraft,
    id?: string,
  ): Promise<boolean> => {
    const isEdit = Boolean(id)
    const response = await fetch(
      isEdit ? `/api/admin/ideas/${id}` : "/api/admin/ideas",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? draft : { ...draft, isPublished: true }),
      },
    )

    if (!response.ok) {
      toast.error(isEdit ? "Could not save changes." : "Could not add idea.")
      return false
    }

    toast.success(isEdit ? "Idea updated." : "Idea added.")
    await loadAll()
    return true
  }

  const patchVideo = async (id: string, payload: Partial<AdminVideo>) => {
    const response = await fetch(`/api/admin/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      toast.error("Could not update the video.")
      return false
    }
    await loadAll()
    return true
  }

  const patchIdea = async (id: string, payload: Partial<AdminIdea>) => {
    const response = await fetch(`/api/admin/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      toast.error("Could not update the idea.")
      return false
    }
    await loadAll()
    return true
  }

  const reorder = async (
    type: "videos" | "ideas",
    id: string,
    direction: "up" | "down",
  ) => {
    const response = await fetch(`/api/admin/${type}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, direction }),
    })
    if (!response.ok) {
      toast.error("Could not change the order.")
      return
    }
    await loadAll()
  }

  const deleteEntity = async (type: "videos" | "ideas", id: string) => {
    const response = await fetch(`/api/admin/${type}/${id}`, {
      method: "DELETE",
    })
    if (!response.ok) {
      toast.error("Could not delete.")
      return
    }
    toast.success(type === "videos" ? "Video deleted." : "Idea deleted.")
    await loadAll()
  }

  const patchUser = async (id: string, payload: Partial<AdminUser>) => {
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      toast.error("Could not update the user.")
      return
    }
    await loadAll()
  }

  const deleteUser = async (id: string) => {
    const response = await fetch(`/api/admin/users/${id}`, { method: "DELETE" })
    if (!response.ok) {
      toast.error("Could not delete the user.")
      return
    }
    toast.success("User deleted.")
    await loadAll()
  }

  const askConfirm = (state: Omit<ConfirmState, "open">) => {
    setConfirm({ ...state, open: true })
  }

  const closeConfirm = (open: boolean) =>
    setConfirm((prev) => ({ ...prev, open }))

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  const publishedVideos = videos.filter((v) => v.isPublished).length
  const publishedIdeas = ideas.filter((i) => i.isPublished).length
  const activeUsers = users.filter((u) => u.isActive).length

  return (
    <section className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-gradient-to-br from-card to-card/50 p-5">
        <div className="space-y-1">
          <p className="font-display text-base font-semibold text-foreground">
            Welcome back
          </p>
          <p className="text-sm text-muted-foreground">
            Manage your videos, ideas, and people in one place.
          </p>
        </div>
        <Button variant="outline" onClick={signOut} className="gap-2">
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Videos"
          value={videos.length}
          icon={<Film className="h-4 w-4" />}
          accent="bg-primary/15 text-primary"
        />
        <StatCard
          label="Ideas"
          value={ideas.length}
          icon={<Lightbulb className="h-4 w-4" />}
          accent="bg-amber-400/15 text-amber-300"
        />
        <StatCard
          label="People"
          value={users.length}
          icon={<Users className="h-4 w-4" />}
          accent="bg-emerald-400/15 text-emerald-300"
        />
      </div>

      <Tabs defaultValue="videos" className="w-full">
        <TabsList className="h-11 rounded-xl bg-muted/40 p-1">
          <TabsTrigger
            value="videos"
            className="gap-2 rounded-lg px-4 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <Film className="h-4 w-4" />
            Videos
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-5 justify-center px-1.5 text-[10px]"
            >
              {publishedVideos}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="ideas"
            className="gap-2 rounded-lg px-4 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <Lightbulb className="h-4 w-4" />
            Ideas
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-5 justify-center px-1.5 text-[10px]"
            >
              {publishedIdeas}
            </Badge>
          </TabsTrigger>
          <TabsTrigger
            value="users"
            className="gap-2 rounded-lg px-4 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <Users className="h-4 w-4" />
            People
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-5 justify-center px-1.5 text-[10px]"
            >
              {activeUsers}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="mt-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={videoQuery}
                onChange={(event) => setVideoQuery(event.target.value)}
                placeholder="Search videos…"
                className="pl-9"
              />
            </div>
            <Button
              onClick={() => setVideoDialog({ open: true, mode: "create" })}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New video
            </Button>
          </div>

          {initialLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card/40 py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filteredVideos.length === 0 ? (
            <EmptyState
              icon={<Film className="h-5 w-5" />}
              title={videos.length === 0 ? "No videos yet" : "Nothing matches"}
              description={
                videos.length === 0
                  ? "Add your first video to bring the homepage to life."
                  : "Try a different search term."
              }
              action={
                videos.length === 0 ? (
                  <Button
                    onClick={() =>
                      setVideoDialog({ open: true, mode: "create" })
                    }
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add a video
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {filteredVideos.map((video) => (
                <AdminVideoCard
                  key={video.id}
                  video={video}
                  onEdit={() =>
                    setVideoDialog({ open: true, mode: "edit", video })
                  }
                  onTogglePublish={() =>
                    void patchVideo(video.id, { isPublished: !video.isPublished })
                  }
                  onMove={(direction) => void reorder("videos", video.id, direction)}
                  onDelete={() =>
                    askConfirm({
                      title: "Delete this video?",
                      description: `“${video.title}” will be removed permanently.`,
                      confirmLabel: "Delete video",
                      destructive: true,
                      action: () => deleteEntity("videos", video.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ideas" className="mt-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={ideaQuery}
                onChange={(event) => setIdeaQuery(event.target.value)}
                placeholder="Search ideas…"
                className="pl-9"
              />
            </div>
            <Button
              onClick={() => setIdeaDialog({ open: true, mode: "create" })}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              New idea
            </Button>
          </div>

          {initialLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card/40 py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filteredIdeas.length === 0 ? (
            <EmptyState
              icon={<Lightbulb className="h-5 w-5" />}
              title={ideas.length === 0 ? "No ideas yet" : "Nothing matches"}
              description={
                ideas.length === 0
                  ? "Capture sparks of inspiration so they don't get lost."
                  : "Try a different search term."
              }
              action={
                ideas.length === 0 ? (
                  <Button
                    onClick={() =>
                      setIdeaDialog({ open: true, mode: "create" })
                    }
                    className="gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add an idea
                  </Button>
                ) : null
              }
            />
          ) : (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredIdeas.map((idea) => (
                <AdminIdeaCard
                  key={idea.id}
                  idea={idea}
                  onEdit={() =>
                    setIdeaDialog({ open: true, mode: "edit", idea })
                  }
                  onTogglePublish={() =>
                    void patchIdea(idea.id, { isPublished: !idea.isPublished })
                  }
                  onMove={(direction) => void reorder("ideas", idea.id, direction)}
                  onDelete={() =>
                    askConfirm({
                      title: "Delete this idea?",
                      description: `“${idea.title}” will be removed permanently.`,
                      confirmLabel: "Delete idea",
                      destructive: true,
                      action: () => deleteEntity("ideas", idea.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="users" className="mt-6 space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={userQuery}
                onChange={(event) => setUserQuery(event.target.value)}
                placeholder="Search by name or email…"
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {filteredUsers.length} of {users.length}
            </p>
          </div>

          {initialLoading ? (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card/40 py-16 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : filteredUsers.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={users.length === 0 ? "No people yet" : "Nothing matches"}
              description={
                users.length === 0
                  ? "Once people sign up they will appear here."
                  : "Try a different search term."
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredUsers.map((user) => (
                <AdminUserRow
                  key={user.id}
                  user={user}
                  isCurrent={user.id === currentUserId}
                  onToggleRole={() =>
                    void patchUser(user.id, {
                      role: user.role === "ADMIN" ? "USER" : "ADMIN",
                    })
                  }
                  onToggleActive={() =>
                    void patchUser(user.id, { isActive: !user.isActive })
                  }
                  onDelete={() =>
                    askConfirm({
                      title: "Delete this account?",
                      description: `${user.fullName || user.email} will lose access immediately.`,
                      confirmLabel: "Delete account",
                      destructive: true,
                      action: () => deleteUser(user.id),
                    })
                  }
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <AdminVideoDialog
        open={videoDialog.open}
        mode={videoDialog.mode}
        initialVideo={videoDialog.video}
        onOpenChange={(open) =>
          setVideoDialog((prev) => ({ ...prev, open }))
        }
        onSubmit={submitVideo}
      />

      <AdminIdeaDialog
        open={ideaDialog.open}
        mode={ideaDialog.mode}
        initialIdea={ideaDialog.idea}
        onOpenChange={(open) => setIdeaDialog((prev) => ({ ...prev, open }))}
        onSubmit={submitIdea}
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
    </section>
  )
}
