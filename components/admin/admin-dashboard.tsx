"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

type AdminVideo = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  category: string
  isPublished: boolean
  sortOrder: number
}

type AdminIdea = {
  id: string
  title: string
  description: string
  category: string
  isPublished: boolean
  sortOrder: number
}

type AdminUser = {
  id: string
  fullName: string
  email: string
  role: "USER" | "ADMIN"
  isActive: boolean
  createdAt: string
}

const emptyVideo = {
  title: "",
  description: "",
  thumbnail: "",
  videoUrl: "",
  duration: "",
  category: "",
}

const emptyIdea = {
  title: "",
  description: "",
  category: "",
}

export function AdminDashboard({ currentUserId }: { currentUserId: string }) {
  const router = useRouter()
  const [videos, setVideos] = useState<AdminVideo[]>([])
  const [ideas, setIdeas] = useState<AdminIdea[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [videoForm, setVideoForm] = useState(emptyVideo)
  const [ideaForm, setIdeaForm] = useState(emptyIdea)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sortedVideos = useMemo(
    () => [...videos].sort((a, b) => a.sortOrder - b.sortOrder),
    [videos],
  )
  const sortedIdeas = useMemo(
    () => [...ideas].sort((a, b) => a.sortOrder - b.sortOrder),
    [ideas],
  )

  const setStatus = (successMessage?: string, failureMessage?: string) => {
    setMessage(successMessage ?? null)
    setError(failureMessage ?? null)
  }

  const loadAll = async () => {
    setLoading(true)
    setStatus()

    try {
      const [videosRes, ideasRes, usersRes] = await Promise.all([
        fetch("/api/admin/videos"),
        fetch("/api/admin/ideas"),
        fetch("/api/admin/users"),
      ])

      if (!videosRes.ok || !ideasRes.ok || !usersRes.ok) {
        throw new Error("Unable to load admin data.")
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
      setStatus(undefined, "Failed to load admin data.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  const submitVideo = async () => {
    setStatus()
    const response = await fetch("/api/admin/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...videoForm, isPublished: true }),
    })

    if (!response.ok) {
      setStatus(undefined, "Could not create video.")
      return
    }

    setVideoForm(emptyVideo)
    setStatus("Video created successfully.")
    await loadAll()
  }

  const submitIdea = async () => {
    setStatus()
    const response = await fetch("/api/admin/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ideaForm, isPublished: true }),
    })

    if (!response.ok) {
      setStatus(undefined, "Could not create idea.")
      return
    }

    setIdeaForm(emptyIdea)
    setStatus("Idea created successfully.")
    await loadAll()
  }

  const patchVideo = async (id: string, payload: Partial<AdminVideo>) => {
    const response = await fetch(`/api/admin/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      setStatus(undefined, "Failed to update video.")
      return
    }
    await loadAll()
  }

  const patchIdea = async (id: string, payload: Partial<AdminIdea>) => {
    const response = await fetch(`/api/admin/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      setStatus(undefined, "Failed to update idea.")
      return
    }
    await loadAll()
  }

  const mimeForThumbnailUpload = (file: File): string | null => {
    if (
      ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
    ) {
      return file.type
    }
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
    if (lower.endsWith(".png")) return "image/png"
    if (lower.endsWith(".webp")) return "image/webp"
    if (lower.endsWith(".gif")) return "image/gif"
    return null
  }

  const mimeForVideoUpload = (file: File): string | null => {
    if (["video/mp4", "video/webm", "video/quicktime"].includes(file.type)) {
      return file.type
    }
    const lower = file.name.toLowerCase()
    if (lower.endsWith(".mp4")) return "video/mp4"
    if (lower.endsWith(".webm")) return "video/webm"
    if (lower.endsWith(".mov")) return "video/quicktime"
    return null
  }

  const uploadAssetToVideoForm = async (field: "thumbnail" | "videoUrl") => {
    try {
      const input = document.createElement("input")
      input.type = "file"
      input.accept =
        field === "thumbnail"
          ? "image/jpeg,image/png,image/webp,image/gif"
          : "video/mp4,video/webm,video/quicktime,.mov"

      await new Promise<void>((resolvePick) => {
        input.onchange = () => resolvePick()
        input.click()
      })

      const file = input.files?.[0]
      if (!file) return

      setStatus()

      const contentType =
        field === "thumbnail" ? mimeForThumbnailUpload(file) : mimeForVideoUpload(file)

      if (!contentType) {
        setStatus(undefined, "Unsupported file type for this field.")
        return
      }

      const formData = new FormData()
      formData.set("file", file, file.name)

      const uploadUrl = new URL("/api/admin/upload", window.location.origin).toString()

      const abort = new AbortController()
      const abortTimer = window.setTimeout(() => abort.abort(), 600_000)

      let uploadRes: Response
      try {
        uploadRes = await fetch(uploadUrl, {
          method: "POST",
          credentials: "same-origin",
          body: formData,
          signal: abort.signal,
        })
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError"
        const isNetwork =
          err instanceof TypeError && err.message === "Failed to fetch"
        setStatus(
          undefined,
          aborted
            ? "Upload timed out after 10 minutes."
            : isNetwork
              ? "Network error while uploading (connection closed or reset). Try a smaller file, or check dev server / reverse proxy body and timeout limits."
              : err instanceof Error
                ? err.message
                : "Upload failed before a response was received.",
        )
        return
      } finally {
        window.clearTimeout(abortTimer)
      }

      let uploadPayload: unknown
      try {
        uploadPayload = await uploadRes.json()
      } catch {
        setStatus(
          undefined,
          `Upload response was not JSON (HTTP ${uploadRes.status}). The server or proxy may have cut off the request.`,
        )
        return
      }

      if (!uploadRes.ok) {
        const msg =
          typeof uploadPayload === "object" &&
          uploadPayload !== null &&
          "message" in uploadPayload &&
          typeof uploadPayload.message === "string"
            ? uploadPayload.message
            : `Upload failed (${uploadRes.status}).`
        setStatus(undefined, msg)
        return
      }

      if (
        typeof uploadPayload !== "object" ||
        uploadPayload === null ||
        typeof (uploadPayload as { publicUrl?: unknown }).publicUrl !== "string"
      ) {
        setStatus(undefined, "Upload succeeded but no public URL was returned.")
        return
      }

      const { publicUrl } = uploadPayload as { publicUrl: string }

      setVideoForm((prev) =>
        field === "thumbnail"
          ? { ...prev, thumbnail: publicUrl }
          : { ...prev, videoUrl: publicUrl },
      )
      setStatus("Uploaded to S3; URL copied into field.")
    } catch (err) {
      setStatus(
        undefined,
        err instanceof Error ? err.message : "Unexpected error during upload.",
      )
    }
  }

  const editVideo = async (video: AdminVideo) => {
    const title = window.prompt("Video title", video.title)
    if (!title) return
    const description = window.prompt("Video description", video.description)
    if (!description) return
    const category = window.prompt("Category", video.category)
    if (!category) return
    const duration = window.prompt("Duration", video.duration)
    if (!duration) return
    const thumbnail = window.prompt("Thumbnail URL", video.thumbnail)
    if (!thumbnail) return
    const videoUrl = window.prompt("Video URL", video.videoUrl)
    if (!videoUrl) return

    await patchVideo(video.id, {
      title,
      description,
      category,
      duration,
      thumbnail,
      videoUrl,
    })
  }

  const editIdea = async (idea: AdminIdea) => {
    const title = window.prompt("Idea title", idea.title)
    if (!title) return
    const description = window.prompt("Idea description", idea.description)
    if (!description) return
    const category = window.prompt("Category", idea.category)
    if (!category) return

    await patchIdea(idea.id, { title, description, category })
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
      setStatus(undefined, "Failed to reorder.")
      return
    }
    await loadAll()
  }

  const deleteEntity = async (type: "videos" | "ideas", id: string) => {
    const response = await fetch(`/api/admin/${type}/${id}`, {
      method: "DELETE",
    })
    if (!response.ok) {
      setStatus(undefined, "Failed to delete.")
      return
    }
    await loadAll()
  }

  const patchUser = async (id: string, payload: Partial<AdminUser>) => {
    const response = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      setStatus(undefined, "Failed to update user.")
      return
    }
    await loadAll()
  }

  const deleteUser = async (id: string) => {
    const response = await fetch(`/api/admin/users/${id}`, { method: "DELETE" })
    if (!response.ok) {
      setStatus(undefined, "Failed to delete user.")
      return
    }
    await loadAll()
  }

  const signOut = async () => {
    await fetch("/api/auth/signout", { method: "POST" })
    router.push("/login")
    router.refresh()
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between rounded-md border border-border bg-card p-4">
        <div>
          <p className="font-medium">Content and user management</p>
          <p className="text-sm text-muted-foreground">
            Create, update, publish, sort, and delete records.
          </p>
        </div>
        <Button variant="outline" onClick={signOut}>
          Sign Out
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}
      {message ? <p className="text-sm text-primary">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Tabs defaultValue="videos" className="w-full">
        <TabsList>
          <TabsTrigger value="videos">Videos</TabsTrigger>
          <TabsTrigger value="ideas">Ideas</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="videos" className="space-y-4">
          <div className="rounded-md border border-border bg-card p-4">
            <p className="mb-4 text-sm font-medium">Create video</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={videoForm.title}
                  onChange={(event) =>
                    setVideoForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <Input
                  value={videoForm.category}
                  onChange={(event) =>
                    setVideoForm((prev) => ({ ...prev, category: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Thumbnail URL</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    className="sm:flex-1"
                    value={videoForm.thumbnail}
                    onChange={(event) =>
                      setVideoForm((prev) => ({ ...prev, thumbnail: event.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={loading}
                    onClick={() => void uploadAssetToVideoForm("thumbnail")}
                  >
                    Upload…
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Video URL</Label>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    className="sm:flex-1"
                    value={videoForm.videoUrl}
                    onChange={(event) =>
                      setVideoForm((prev) => ({ ...prev, videoUrl: event.target.value }))
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    disabled={loading}
                    onClick={() => void uploadAssetToVideoForm("videoUrl")}
                  >
                    Upload…
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Duration</Label>
                <Input
                  value={videoForm.duration}
                  onChange={(event) =>
                    setVideoForm((prev) => ({ ...prev, duration: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={videoForm.description}
                  onChange={(event) =>
                    setVideoForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </div>
            </div>
            <Button className="mt-3" onClick={submitVideo}>
              Add Video
            </Button>
          </div>

          <div className="space-y-3">
            {sortedVideos.map((video) => (
              <div
                key={video.id}
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{video.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {video.category} | order {video.sortOrder}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reorder("videos", video.id, "up")}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reorder("videos", video.id, "down")}
                    >
                      Down
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => editVideo(video)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        patchVideo(video.id, { isPublished: !video.isPublished })
                      }
                    >
                      {video.isPublished ? "Unpublish" : "Publish"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm("Delete this video?")) {
                          void deleteEntity("videos", video.id)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="ideas" className="space-y-4">
          <div className="rounded-md border border-border bg-card p-4">
            <p className="mb-4 text-sm font-medium">Create idea</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={ideaForm.title}
                  onChange={(event) =>
                    setIdeaForm((prev) => ({ ...prev, title: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Category</Label>
                <Input
                  value={ideaForm.category}
                  onChange={(event) =>
                    setIdeaForm((prev) => ({ ...prev, category: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={ideaForm.description}
                  onChange={(event) =>
                    setIdeaForm((prev) => ({ ...prev, description: event.target.value }))
                  }
                />
              </div>
            </div>
            <Button className="mt-3" onClick={submitIdea}>
              Add Idea
            </Button>
          </div>

          <div className="space-y-3">
            {sortedIdeas.map((idea) => (
              <div key={idea.id} className="rounded-md border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">{idea.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {idea.category} | order {idea.sortOrder}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reorder("ideas", idea.id, "up")}
                    >
                      Up
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reorder("ideas", idea.id, "down")}
                    >
                      Down
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => editIdea(idea)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => patchIdea(idea.id, { isPublished: !idea.isPublished })}
                    >
                      {idea.isPublished ? "Unpublish" : "Publish"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm("Delete this idea?")) {
                          void deleteEntity("ideas", idea.id)
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="users" className="space-y-3">
          {users.map((user) => (
            <div key={user.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{user.fullName}</p>
                  <p className="text-sm text-muted-foreground">
                    {user.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {user.role} | {user.isActive ? "active" : "inactive"} |{" "}
                    {new Date(user.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patchUser(user.id, { role: user.role === "ADMIN" ? "USER" : "ADMIN" })
                    }
                  >
                    Role: {user.role === "ADMIN" ? "Set USER" : "Set ADMIN"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => patchUser(user.id, { isActive: !user.isActive })}
                    disabled={user.id === currentUserId}
                  >
                    {user.isActive ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={user.id === currentUserId}
                    onClick={() => {
                      if (window.confirm("Delete this user?")) {
                        void deleteUser(user.id)
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </section>
  )
}
