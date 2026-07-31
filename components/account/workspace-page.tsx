"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Archive,
  ChevronRight,
  Columns3,
  FileText,
  Folder,
  FolderOpen,
  Grid3X3,
  Image as ImageIcon,
  List,
  Loader2,
  MessageCircle,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Trash2,
  Upload,
  Video,
  ArrowLeft,
  Download,
  Pencil,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { resolveProjectContentType } from "@/lib/project-upload-policy"
import { useI18n, type Dictionary } from "@/components/account/i18n"

function mediaUrlForKey(key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/")
  return `/api/media/${encoded}`
}

type Project = {
  id: string
  ownerId: string
  name: string
  description: string
  groupName: "personal" | "shared" | "tools" | "archive"
  isPaused: boolean
  createdAt: string
  updatedAt: string
  unreadCount: number
}

type ProjectFile = {
  id: string
  projectId: string
  folderPath: string
  name: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number
  contentType: string
  createdAt: string
}

type ChatMessage = {
  id: string
  projectId: string
  senderId: string | null
  senderRole: "user" | "team"
  text: string
  createdAt: string
}

type ViewMode = "list" | "grid" | "columns"
type BottomTab = "desc" | "settings" | "chat"
type MobileTab = "files" | "desc" | "settings" | "chat"

const GROUP_ORDER = ["shared", "personal", "tools", "archive"] as const

function groupLabel(name: string, t: Dictionary) {
  switch (name) {
    case "shared":
      return t.groupShared
    case "tools":
      return t.groupTools
    case "archive":
      return t.groupArchive
    default:
      return t.groupPersonal
  }
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string, lang: string) {
  try {
    return new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  } catch {
    return ""
  }
}

function fileIcon(f: ProjectFile) {
  if (f.isFolder) return Folder
  const ct = f.contentType
  if (ct.startsWith("image/")) return ImageIcon
  if (ct.startsWith("video/")) return Video
  if (ct.startsWith("audio/")) return Music
  if (ct.includes("json")) return FileText
  return FileText
}

function fileColor(f: ProjectFile) {
  if (f.isFolder) return "#c9ccd3"
  if (f.contentType.startsWith("image/")) return "#40c48a"
  if (f.contentType.startsWith("video/")) return "#4a9be8"
  if (f.contentType.startsWith("audio/")) return "#f0b73a"
  return "#8b93a3"
}

type ContextMenu = {
  x: number
  y: number
  kind: "file" | "empty" | "project"
  file?: ProjectFile
  projectId?: string
}

export function WorkspacePageClient() {
  const { t, lang } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [query, setQuery] = useState("")
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id"),
  )
  const [path, setPath] = useState<string[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null)
  const [view, setView] = useState<ViewMode>("list")
  const [bottomTab, setBottomTab] = useState<BottomTab>("desc")
  const [mobileTab, setMobileTab] = useState<MobileTab>("files")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [descDraft, setDescDraft] = useState("")
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [uploading, setUploading] = useState(false)
  const [mobileShowProject, setMobileShowProject] = useState(false)

  const selected = projects.find((p) => p.id === selectedId) ?? null
  const folderPath = path.join("/")

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const res = await fetch("/api/projects")
      if (!res.ok) return
      const data = await res.json()
      setProjects(data.projects ?? [])
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadFiles = useCallback(async (projectId: string, folder: string) => {
    setLoadingFiles(true)
    try {
      const res = await fetch(
        `/api/projects/${projectId}/files?folderPath=${encodeURIComponent(folder)}`,
      )
      if (!res.ok) return
      const data = await res.json()
      setFiles(data.files ?? [])
    } finally {
      setLoadingFiles(false)
    }
  }, [])

  const loadMessages = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/messages`)
    if (!res.ok) return
    const data = await res.json()
    setMessages(data.messages ?? [])
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, unreadCount: 0 } : p)),
    )
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    const id = searchParams.get("id")
    if (id) {
      setSelectedId(id)
      setMobileShowProject(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (!selectedId) {
      setFiles([])
      setPath([])
      setSelectedFile(null)
      setMessages([])
      return
    }
    void loadFiles(selectedId, folderPath)
  }, [selectedId, folderPath, loadFiles])

  useEffect(() => {
    if (selected) setDescDraft(selected.description ?? "")
  }, [selected])

  useEffect(() => {
    if (selectedId && (bottomTab === "chat" || mobileTab === "chat")) {
      void loadMessages(selectedId)
    }
  }, [selectedId, bottomTab, mobileTab, loadMessages])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const map = new Map<string, Project[]>()
    for (const g of GROUP_ORDER) map.set(g, [])
    for (const p of projects) {
      if (q && !p.name.toLowerCase().includes(q)) continue
      const key = GROUP_ORDER.includes(p.groupName) ? p.groupName : "personal"
      map.get(key)!.push(p)
    }
    return GROUP_ORDER.map((name) => ({
      name,
      items: map.get(name) ?? [],
    })).filter((g) => g.items.length > 0)
  }, [projects, query])

  const selectProject = (id: string) => {
    setSelectedId(id)
    setPath([])
    setSelectedFile(null)
    setDraft("")
    setMobileShowProject(true)
    router.replace(`/account/projects?id=${id}`, { scroll: false })
  }

  const createProject = async () => {
    const name =
      lang === "ru"
        ? `Новый проект ${projects.length + 1}`
        : `New project ${projects.length + 1}`
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) {
      toast.error("Failed")
      return
    }
    const data = await res.json()
    await loadProjects()
    selectProject(data.project.id)
  }

  const patchProject = async (
    id: string,
    body: Record<string, unknown>,
  ) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      toast.error("Failed")
      return
    }
    const data = await res.json()
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...data.project } : p)),
    )
  }

  const deleteProject = async (id: string) => {
    if (!confirm(t.confirmDeleteProject)) return
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" })
    if (!res.ok) {
      toast.error("Failed")
      return
    }
    setSelectedId(null)
    setMobileShowProject(false)
    router.replace("/account/projects", { scroll: false })
    await loadProjects()
  }

  const saveDescription = async () => {
    if (!selectedId) return
    await patchProject(selectedId, { description: descDraft })
    toast.success(t.saveDescription)
  }

  const sendMessage = async () => {
    if (!selectedId || !draft.trim()) return
    const text = draft.trim()
    setDraft("")
    const res = await fetch(`/api/projects/${selectedId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      toast.error("Failed")
      setDraft(text)
      return
    }
    const data = await res.json()
    setMessages((m) => [...m, data.message])
  }

  const openFolder = (name: string) => {
    setPath((p) => [...p, name])
    setSelectedFile(null)
  }

  const goCrumb = (idx: number) => {
    setPath((p) => (idx < 0 ? [] : p.slice(0, idx + 1)))
    setSelectedFile(null)
  }

  const createFolder = async () => {
    if (!selectedId) return
    const name = prompt(t.folderNamePrompt)
    if (!name?.trim()) return
    const res = await fetch(`/api/projects/${selectedId}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderPath, name: name.trim() }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.message ?? "Failed")
      return
    }
    await loadFiles(selectedId, folderPath)
  }

  const renameItem = async (file: ProjectFile) => {
    if (!selectedId) return
    const name = prompt(t.renamePrompt, file.name)
    if (!name?.trim() || name.trim() === file.name) return
    const res = await fetch(`/api/projects/${selectedId}/files`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: file.id, name: name.trim() }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.message ?? "Failed")
      return
    }
    await loadFiles(selectedId, folderPath)
  }

  const deleteItem = async (file: ProjectFile) => {
    if (!selectedId) return
    if (!confirm(t.confirmDelete)) return
    const res = await fetch(`/api/projects/${selectedId}/files`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: file.id }),
    })
    if (!res.ok) {
      toast.error("Failed")
      return
    }
    if (selectedFile?.id === file.id) setSelectedFile(null)
    await loadFiles(selectedId, folderPath)
  }

  const uploadFiles = async (fileList: FileList | File[]) => {
    if (!selectedId) return
    const list = Array.from(fileList)
    if (!list.length) return
    setUploading(true)
    try {
      for (const file of list) {
        const contentType =
          resolveProjectContentType(file) ?? "application/octet-stream"
        const presign = await fetch(
          `/api/projects/${selectedId}/files/presign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              contentType,
              folderPath,
              sizeBytes: file.size,
            }),
          },
        )
        if (!presign.ok) {
          const data = await presign.json().catch(() => ({}))
          toast.error(data.message ?? "Presign failed")
          continue
        }
        const { uploadUrl, key } = await presign.json()
        const put = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": contentType },
        })
        if (!put.ok) {
          toast.error(`Upload failed: ${file.name}`)
          continue
        }
        const confirm = await fetch(
          `/api/projects/${selectedId}/files/presign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              contentType,
              folderPath,
              s3Key: key,
              sizeBytes: file.size,
            }),
          },
        )
        if (!confirm.ok) {
          const data = await confirm.json().catch(() => ({}))
          toast.error(data.message ?? "Confirm failed")
        }
      }
      await loadFiles(selectedId, folderPath)
    } finally {
      setUploading(false)
    }
  }

  const openContext = (
    e: React.MouseEvent,
    kind: ContextMenu["kind"],
    extra?: Partial<ContextMenu>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 240),
      kind,
      ...extra,
    })
  }

  const crumbs = [
    { name: t.projectRoot, idx: -1 },
    ...path.map((n, i) => ({ name: n, idx: i })),
  ]

  const showDesktopProject = Boolean(selected)
  const showMobileList = !mobileShowProject
  const showMobileProject = mobileShowProject && selected

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void uploadFiles(e.target.files)
          e.target.value = ""
        }}
      />

      {/* ===== PROJECTS COLUMN (desktop) ===== */}
      <section
        className={cn(
          "hidden w-[300px] shrink-0 flex-col border-r border-white/[0.08] bg-[#0a0e16] lg:flex",
        )}
      >
        <div className="shrink-0 px-4 pb-3 pt-4">
          <div className="flex items-baseline justify-between">
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-4 rounded bg-[#5b9be0]" />
              <span className="text-[14px] font-semibold tracking-[1.6px] text-[#5b9be0]">
                {t.projectsHeading}
              </span>
            </div>
            <span className="text-[12px] text-[#626875]">{projects.length}</span>
          </div>
          <div className="relative mt-3">
            <Search className="absolute left-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#626875]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchProjects}
              className="h-[38px] w-full rounded-[9px] border border-white/10 bg-[#10151f] py-0 pl-[34px] pr-3 text-[13px] text-[#eef1f6] outline-none focus:border-[#2f80ed]"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2.5">
          {loadingProjects ? (
            <div className="flex justify-center py-10 text-[#626875]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <div className="px-3 py-8 text-center text-[13px] text-[#626875]">
              {t.emptyProjects}
            </div>
          ) : (
            groups.map((g) => {
              const open = !collapsedGroups[g.name]
              return (
                <div key={g.name} className="mt-2.5 rounded-xl px-3 pb-3 pt-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((c) => ({
                        ...c,
                        [g.name]: open,
                      }))
                    }
                    className="flex w-full items-center gap-2 px-2 py-1.5"
                  >
                    <ChevronRight
                      className={cn(
                        "h-4 w-4 text-[#626875] transition-transform",
                        open && "rotate-90",
                      )}
                    />
                    <span className="whitespace-nowrap text-[14px] font-semibold tracking-wide text-[#5b9be0]">
                      {groupLabel(g.name, t)}
                    </span>
                    <span className="h-px flex-1 bg-white/[0.07]" />
                    <span className="text-[14px] text-[#4a5060]">
                      {g.items.length}
                    </span>
                  </button>
                  {open &&
                    g.items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        project={p}
                        selected={p.id === selectedId}
                        t={t}
                        onSelect={() => selectProject(p.id)}
                        onTogglePause={(e) => {
                          e.stopPropagation()
                          void patchProject(p.id, { isPaused: !p.isPaused })
                        }}
                        onChat={(e) => {
                          e.stopPropagation()
                          selectProject(p.id)
                          setBottomTab("chat")
                          setMobileTab("chat")
                        }}
                        onContext={(e) =>
                          openContext(e, "project", { projectId: p.id })
                        }
                      />
                    ))}
                </div>
              )
            })
          )}
        </div>

        <div className="shrink-0 border-t border-white/[0.07] p-3">
          <button
            type="button"
            onClick={createProject}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-[#1d6ff2] text-[14px] font-medium text-white hover:bg-[#175fd6]"
          >
            <Plus className="h-[18px] w-[18px]" />
            {t.newProject}
          </button>
        </div>
      </section>

      {/* ===== MOBILE: project list ===== */}
      {showMobileList && (
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:hidden">
          <div className="shrink-0 border-b border-white/[0.07] px-4 pb-4 pt-[18px]">
            <h1 className="text-[26px] font-bold tracking-tight">
              {t.yourProjects}
            </h1>
            <div className="mt-3.5 flex gap-2.5">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#626875]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.searchProjects}
                  className="h-[46px] w-full rounded-xl border border-white/10 bg-[#0d121c] py-0 pl-10 pr-3 text-[15px] outline-none focus:border-[#2f80ed]"
                />
              </div>
              <button
                type="button"
                onClick={createProject}
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-[#1d6ff2] text-white"
              >
                <Plus className="h-[22px] w-[22px]" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {groups.map((g) => {
              const open = !collapsedGroups[g.name]
              return (
                <div key={g.name} className="mb-3.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((c) => ({
                        ...c,
                        [g.name]: open,
                      }))
                    }
                    className="flex w-full items-center gap-2 px-1 py-2"
                  >
                    <ChevronRight
                      className={cn(
                        "h-[19px] w-[19px] text-[#626875]",
                        open && "rotate-90",
                      )}
                    />
                    <span className="text-[13px] font-semibold tracking-wide text-[#5b9be0]">
                      {groupLabel(g.name, t)}
                    </span>
                    <span className="h-px flex-1 bg-white/[0.07]" />
                    <span className="text-[12.5px] text-[#4a5060]">
                      {g.items.length}
                    </span>
                  </button>
                  {open && (
                    <div className="mt-2 flex flex-col gap-2">
                      {g.items.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectProject(p.id)}
                          className="flex items-center gap-3 rounded-[14px] border border-white/10 bg-[hsl(226_26%_9.5%)] p-3.5 text-left"
                        >
                          <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                            <FolderOpen className="h-[21px] w-[21px] text-[#8b909c]" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[15.5px] font-semibold">
                              {p.name}
                            </div>
                            <div className="mt-0.5 text-[12px] text-[#7c8290]">
                              {p.isPaused ? t.statusPaused : t.statusActive} ·{" "}
                              {fmtDate(p.createdAt, lang)}
                            </div>
                          </div>
                          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 text-[#c3c8d2]">
                            <MessageCircle className="h-5 w-5" />
                            {p.unreadCount > 0 && (
                              <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[#2f80ed]" />
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== MAIN WORKSPACE ===== */}
      <main
        className={cn(
          "min-w-0 flex-1 flex-col overflow-hidden",
          showDesktopProject ? "lg:flex" : "lg:flex",
          showMobileProject ? "flex" : "hidden lg:flex",
        )}
      >
        {!selected ? (
          <div className="hidden flex-1 flex-col overflow-hidden lg:flex">
            <div className="shrink-0 border-b border-white/[0.07] px-12 pb-6 pt-11">
              <div className="mx-auto max-w-[1120px]">
                <div className="flex items-center gap-3">
                  <span className="h-0.5 w-[34px] rounded bg-[#5b9be0]" />
                  <span className="text-[13px] font-semibold tracking-[2.4px] text-[#5b9be0]">
                    {t.projectsHeading}
                  </span>
                </div>
                <h1 className="mt-5 text-[46px] font-bold tracking-tight">
                  {t.yourProjects}
                </h1>
                <p className="mt-3.5 max-w-[680px] text-[16px] text-[#9aa0ac]">
                  {t.yourProjectsSub}
                </p>
                <div className="mt-7 flex flex-wrap items-center gap-3.5">
                  <div className="relative min-w-[260px] max-w-[600px] flex-1">
                    <Search className="absolute left-3.5 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-[#626875]" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t.searchProjects}
                      className="h-[52px] w-full rounded-xl border border-white/10 bg-[#0d121c] py-0 pl-11 pr-4 text-[15px] outline-none focus:border-[#2f80ed]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={createProject}
                    className="flex h-[52px] items-center gap-2 rounded-xl bg-[#1d6ff2] px-[22px] text-[15px] font-medium text-white hover:bg-[#3b8bf0]"
                  >
                    <Plus className="h-5 w-5" />
                    {t.newProject}
                  </button>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-12 py-7">
              <div className="mx-auto flex max-w-[1120px] flex-col gap-6">
                {groups.map((g) => (
                  <div key={g.name}>
                    <div className="flex items-center gap-2.5 px-0.5 py-1.5">
                      <span className="text-[15px] font-semibold tracking-[1.4px] text-[#5b9be0]">
                        {groupLabel(g.name, t)}
                      </span>
                      <span className="h-px flex-1 bg-white/[0.07]" />
                      <span className="text-[13px] text-[#4a5060]">
                        {g.items.length}
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
                      {g.items.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => selectProject(p.id)}
                          className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[hsl(226_26%_9.5%)] p-[22px] text-left hover:border-white/[0.18] hover:bg-[hsl(226_26%_11%)]"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
                              <FolderOpen className="h-[22px] w-[22px] text-[#8b909c]" />
                            </div>
                          </div>
                          <div>
                            <div className="text-[20px] font-semibold tracking-tight">
                              {p.name}
                            </div>
                            <div className="mt-2.5 text-[13px] text-[#7c8290]">
                              {fmtDate(p.createdAt, lang)}
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
                            <span className="text-[13px] text-[#9aa0ac]">
                              {p.isPaused ? t.statusPaused : t.statusActive}
                            </span>
                            <span className="flex items-center gap-2 rounded-[9px] border border-white/10 px-3.5 py-2 text-[13px] text-[#c3c8d2]">
                              <MessageCircle className="h-[17px] w-[17px]" />
                              {t.chat}
                              {p.unreadCount > 0 && (
                                <span className="h-1.5 w-1.5 rounded-full bg-[#2f80ed]" />
                              )}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null)
                    setMobileShowProject(false)
                    router.replace("/account/projects", { scroll: false })
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-white/10 bg-[#0d121c] text-[#9aa0ac] hover:bg-[#151d2b] hover:text-[#eef1f6]"
                >
                  <ArrowLeft className="h-[19px] w-[19px]" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedId(null)
                    setMobileShowProject(false)
                    router.replace("/account/projects", { scroll: false })
                  }}
                  className="hidden rounded-lg px-2 py-1 text-[16px] font-medium text-[#9aa0ac] hover:bg-white/5 hover:text-[#eef1f6] sm:inline"
                >
                  {t.allProjectsCrumb}
                </button>
                <span className="hidden text-[16px] text-[#3a4050] sm:inline">
                  /
                </span>
                <span className="truncate text-[15.5px] font-semibold md:text-[16px]">
                  {selected.name}
                </span>
                {selected.isPaused && (
                  <span className="hidden items-center gap-1 rounded-full border border-white/10 px-2.5 py-0.5 text-[12px] text-[#9aa0ac] sm:flex">
                    <Pause className="h-3.5 w-3.5" />
                    {t.paused}
                  </span>
                )}
              </div>
              <div className="hidden items-center gap-3 md:flex">
                <div className="flex gap-0.5 rounded-[9px] border border-white/10 bg-[#10151f] p-[3px]">
                  {(
                    [
                      ["list", List, t.viewList],
                      ["grid", Grid3X3, t.viewGrid],
                      ["columns", Columns3, t.viewColumns],
                    ] as const
                  ).map(([mode, Icon, label]) => (
                    <button
                      key={mode}
                      type="button"
                      title={label}
                      onClick={() => setView(mode)}
                      className={cn(
                        "flex h-7 w-[30px] items-center justify-center rounded-md",
                        view === mode
                          ? "bg-[rgba(45,131,206,0.35)] text-[#eef1f6]"
                          : "text-[#8b909c] hover:text-[#eef1f6]",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    selectedId && void loadFiles(selectedId, folderPath)
                  }
                  className="flex items-center gap-1.5 text-[13px] text-[#c3c8d2] hover:text-[#eef1f6]"
                >
                  <RefreshCw className="h-[18px] w-[18px]" />
                  {t.refresh}
                </button>
              </div>
            </div>

            {/* Desktop files + bottom */}
            <div className="hidden min-h-0 flex-1 flex-col overflow-hidden lg:flex">
              <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-3 pt-5 md:px-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {crumbs.map((c, i) => (
                      <span key={`${c.name}-${i}`} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => goCrumb(c.idx)}
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[12px]",
                            i === crumbs.length - 1
                              ? "text-[#c3c8d2]"
                              : "text-[#626875] hover:bg-white/5",
                          )}
                        >
                          {c.name}
                        </button>
                        {i < crumbs.length - 1 && (
                          <span className="text-[12px] text-[#3a4050]">/</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={createFolder}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-[#c3c8d2] hover:bg-white/5"
                    >
                      {t.mNewFolder}
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="flex items-center gap-1.5 rounded-lg bg-[#1d6ff2] px-3 py-1.5 text-[12px] text-white hover:bg-[#175fd6] disabled:opacity-60"
                    >
                      {uploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {t.upload}
                    </button>
                  </div>
                </div>

                <div
                  className="relative flex min-h-0 flex-1 overflow-hidden rounded-[14px] border border-white/10 bg-[hsl(226_26%_9.5%)]"
                  onContextMenu={(e) => openContext(e, "empty")}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (e.dataTransfer.files.length)
                      void uploadFiles(e.dataTransfer.files)
                  }}
                >
                  <div className="min-w-0 flex-1 overflow-y-auto p-2.5">
                    {loadingFiles ? (
                      <div className="flex justify-center py-16 text-[#626875]">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : files.length === 0 ? (
                      <div className="flex h-full min-h-[140px] items-center justify-center text-[12.5px] text-[#4a5060]">
                        {t.emptyFolder}
                      </div>
                    ) : view === "grid" ? (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
                        {files.map((f) => (
                          <FileButton
                            key={f.id}
                            file={f}
                            selected={selectedFile?.id === f.id}
                            mode="grid"
                            lang={lang}
                            onOpen={() =>
                              f.isFolder
                                ? openFolder(f.name)
                                : setSelectedFile(f)
                            }
                            onContext={(e) =>
                              openContext(e, "file", { file: f })
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {files.map((f) => (
                          <FileButton
                            key={f.id}
                            file={f}
                            selected={selectedFile?.id === f.id}
                            mode="list"
                            lang={lang}
                            onOpen={() =>
                              f.isFolder
                                ? openFolder(f.name)
                                : setSelectedFile(f)
                            }
                            onContext={(e) =>
                              openContext(e, "file", { file: f })
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Preview pane */}
                  <div className="hidden w-[264px] shrink-0 overflow-y-auto border-l border-white/[0.07] bg-[#0a0e16] p-[18px] xl:block">
                    {selectedFile && !selectedFile.isFolder ? (
                      <PreviewPane file={selectedFile} t={t} lang={lang} />
                    ) : (
                      <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2.5 text-center text-[#4a5060]">
                        <FolderOpen className="h-[34px] w-[34px]" />
                        <span className="text-[12.5px]">{t.previewEmpty}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom tabs */}
              <div className="relative mx-2.5 mb-3 flex h-[280px] shrink-0 flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[hsl(226_26%_9.5%)] md:mx-6">
                <div className="flex shrink-0 flex-wrap gap-1.5 px-6 pt-3">
                  {(
                    [
                      ["desc", FileText, t.tabDesc],
                      ["settings", Settings2, t.tabSettings],
                      ["chat", MessageCircle, t.tabChat],
                    ] as const
                  ).map(([tab, Icon, label]) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setBottomTab(tab)}
                      className={cn(
                        "flex items-center gap-2 rounded-t-[9px] px-4 py-2 text-[13.5px]",
                        bottomTab === tab
                          ? "bg-[#10151f] text-[#eef1f6]"
                          : "text-[#8b909c] hover:text-[#eef1f6]",
                      )}
                    >
                      <Icon className="h-[18px] w-[18px]" />
                      {label}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[0.07] px-6 py-5">
                  <BottomPanel
                    tab={bottomTab}
                    selected={selected}
                    descDraft={descDraft}
                    setDescDraft={setDescDraft}
                    onSaveDesc={saveDescription}
                    onTogglePause={() =>
                      void patchProject(selected.id, {
                        isPaused: !selected.isPaused,
                      })
                    }
                    onArchive={() =>
                      void patchProject(selected.id, { groupName: "archive" })
                    }
                    onDelete={() => void deleteProject(selected.id)}
                    messages={messages}
                    draft={draft}
                    setDraft={setDraft}
                    onSend={sendMessage}
                    t={t}
                    lang={lang}
                  />
                </div>
              </div>
            </div>

            {/* Mobile project body */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
              {mobileTab === "files" && (
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    {crumbs.map((c, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => goCrumb(c.idx)}
                          className="rounded px-1.5 py-1 text-[12.5px] text-[#9aa0ac]"
                        >
                          {c.name}
                        </button>
                        {i < crumbs.length - 1 && (
                          <span className="text-[#3a4050]">/</span>
                        )}
                      </span>
                    ))}
                  </div>
                  <div className="mb-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d6ff2] py-2.5 text-[14px] text-white"
                    >
                      <Upload className="h-4 w-4" />
                      {t.upload}
                    </button>
                    <button
                      type="button"
                      onClick={createFolder}
                      className="rounded-xl border border-white/10 px-3 py-2.5 text-[14px] text-[#c3c8d2]"
                    >
                      <Folder className="h-4 w-4" />
                    </button>
                  </div>
                  {files.length === 0 ? (
                    <div className="py-10 text-center text-[13px] text-[#4a5060]">
                      {t.emptyFolder}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {files.map((f) => (
                        <FileButton
                          key={f.id}
                          file={f}
                          selected={selectedFile?.id === f.id}
                          mode="list"
                          lang={lang}
                          onOpen={() =>
                            f.isFolder ? openFolder(f.name) : setSelectedFile(f)
                          }
                          onContext={(e) =>
                            openContext(e, "file", { file: f })
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {mobileTab !== "files" && (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <BottomPanel
                    tab={mobileTab === "desc" ? "desc" : mobileTab === "settings" ? "settings" : "chat"}
                    selected={selected}
                    descDraft={descDraft}
                    setDescDraft={setDescDraft}
                    onSaveDesc={saveDescription}
                    onTogglePause={() =>
                      void patchProject(selected.id, {
                        isPaused: !selected.isPaused,
                      })
                    }
                    onArchive={() =>
                      void patchProject(selected.id, { groupName: "archive" })
                    }
                    onDelete={() => void deleteProject(selected.id)}
                    messages={messages}
                    draft={draft}
                    setDraft={setDraft}
                    onSend={sendMessage}
                    t={t}
                    lang={lang}
                  />
                </div>
              )}

              <div className="grid shrink-0 grid-cols-4 border-t border-white/10 bg-[hsl(226_28%_9%)] px-1 pb-2.5 pt-1.5">
                {(
                  [
                    ["files", FolderOpen, t.tabFiles],
                    ["desc", FileText, t.tabDesc],
                    ["settings", Settings2, t.tabSettings],
                    ["chat", MessageCircle, t.tabChat],
                  ] as const
                ).map(([tab, Icon, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMobileTab(tab)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                      mobileTab === tab ? "text-[#7fb6ff]" : "text-[#8b909c]",
                    )}
                  >
                    <Icon className="h-[23px] w-[23px]" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </main>

      {/* Context menu */}
      {menu && (
        <div
          className="fixed z-[120] min-w-[216px] rounded-[11px] border border-white/10 bg-[#131926] p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === "file" && menu.file && (
            <>
              {!menu.file.isFolder && menu.file.s3Key && (
                <MenuBtn
                  icon={<Download className="h-[18px] w-[18px]" />}
                  label={t.mDownload}
                  onClick={() => {
                    window.open(
                      mediaUrlForKey(menu.file!.s3Key!),
                      "_blank",
                    )
                    setMenu(null)
                  }}
                />
              )}
              <MenuBtn
                icon={<Pencil className="h-[18px] w-[18px]" />}
                label={t.mRename}
                onClick={() => {
                  void renameItem(menu.file!)
                  setMenu(null)
                }}
              />
              <div className="my-1 h-px bg-white/10" />
              <MenuBtn
                icon={<Trash2 className="h-[18px] w-[18px]" />}
                label={t.mDelete}
                danger
                onClick={() => {
                  void deleteItem(menu.file!)
                  setMenu(null)
                }}
              />
            </>
          )}
          {menu.kind === "empty" && (
            <>
              <MenuBtn
                icon={<Folder className="h-[18px] w-[18px]" />}
                label={t.mNewFolder}
                onClick={() => {
                  void createFolder()
                  setMenu(null)
                }}
              />
              <MenuBtn
                icon={<Upload className="h-[18px] w-[18px]" />}
                label={t.mUploadFile}
                onClick={() => {
                  fileInputRef.current?.click()
                  setMenu(null)
                }}
              />
            </>
          )}
          {menu.kind === "project" && menu.projectId && (
            <>
              <MenuBtn
                icon={<Archive className="h-[18px] w-[18px]" />}
                label={t.archiveProject}
                onClick={() => {
                  void patchProject(menu.projectId!, { groupName: "archive" })
                  setMenu(null)
                }}
              />
              <MenuBtn
                icon={<Trash2 className="h-[18px] w-[18px]" />}
                label={t.deleteProject}
                danger
                onClick={() => {
                  void deleteProject(menu.projectId!)
                  setMenu(null)
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  project: p,
  selected,
  t,
  onSelect,
  onTogglePause,
  onChat,
  onContext,
}: {
  project: Project
  selected: boolean
  t: Dictionary
  onSelect: () => void
  onTogglePause: (e: React.MouseEvent) => void
  onChat: (e: React.MouseEvent) => void
  onContext: (e: React.MouseEvent) => void
}) {
  return (
    <div
      onClick={onSelect}
      onContextMenu={onContext}
      className={cn(
        "relative mb-1.5 cursor-pointer rounded-lg border",
        selected
          ? "border-[rgba(47,128,237,0.55)] bg-gradient-to-b from-[rgba(47,128,237,0.22)] to-[rgba(47,128,237,0.06)]"
          : "border-[#383838] bg-transparent hover:border-white/20",
        p.isPaused && !selected && "opacity-55",
      )}
    >
      {selected && (
        <div className="absolute bottom-2 left-0 top-2 w-[3px] rounded bg-[#2f80ed]" />
      )}
      <div className="flex items-center gap-2.5 px-2.5 py-2.5">
        <Folder
          className={cn(
            "h-5 w-5 shrink-0",
            selected ? "text-[#5ed4c0]" : "text-[#8b909c]",
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[16px]",
            selected ? "text-[#eef1f6]" : "text-[#c3c8d2]",
          )}
        >
          {p.name}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pb-2.5">
        <button
          type="button"
          onClick={onTogglePause}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]",
            p.isPaused
              ? "border border-white/10 text-[#8b909c]"
              : "border border-[rgba(62,207,142,0.4)] bg-[rgba(62,207,142,0.1)] text-[#3ecf8e]",
          )}
        >
          {p.isPaused ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {p.isPaused ? t.statusPaused : t.statusActive}
        </button>
        <button
          type="button"
          onClick={onChat}
          className={cn(
            "relative flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]",
            p.unreadCount > 0
              ? "border border-[rgba(45,131,206,0.5)] bg-[rgba(45,131,206,0.12)] text-[#7fb6ff]"
              : "border border-white/10 text-[#8b909c]",
          )}
        >
          <MessageCircle className="h-3 w-3" />
          {t.chat}
          {p.unreadCount > 0 && (
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f80ed]" />
          )}
        </button>
      </div>
    </div>
  )
}

function FileButton({
  file: f,
  selected,
  mode,
  lang,
  onOpen,
  onContext,
}: {
  file: ProjectFile
  selected: boolean
  mode: "list" | "grid"
  lang: string
  onOpen: () => void
  onContext: (e: React.MouseEvent) => void
}) {
  const Icon = fileIcon(f)
  const color = fileColor(f)
  const meta = f.isFolder
    ? "folder"
    : `${fmtSize(f.sizeBytes)} · ${fmtDate(f.createdAt, lang)}`

  if (mode === "grid") {
    return (
      <button
        type="button"
        onClick={onOpen}
        onContextMenu={onContext}
        className={cn(
          "flex items-center gap-3 rounded-[11px] border bg-[#10151f] p-3 text-left hover:border-white/[0.18]",
          selected ? "border-[#2f80ed]" : "border-white/10",
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.04]">
          <Icon className="h-6 w-6" style={{ color }} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] text-[#eef1f6]">{f.name}</div>
          <div className="text-[11.5px] text-[#626875]">{meta}</div>
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContext}
      className={cn(
        "flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left hover:bg-white/5",
        selected
          ? "border-[rgba(45,131,206,0.55)] bg-[rgba(45,131,206,0.16)]"
          : "border-white/[0.07] bg-[#10151f]",
      )}
    >
      <Icon className="h-5 w-5 shrink-0" style={{ color }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-[#eef1f6]">{f.name}</div>
        <div className="text-[11.5px] text-[#626875]">{meta}</div>
      </div>
      {f.isFolder && <ChevronRight className="h-4 w-4 text-[#626875]" />}
    </button>
  )
}

function PreviewPane({
  file,
  t,
  lang,
}: {
  file: ProjectFile
  t: Dictionary
  lang: string
}) {
  const Icon = fileIcon(file)
  const url = file.s3Key ? mediaUrlForKey(file.s3Key) : null
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-3.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-[10px] border border-white/10 bg-[#10151f]">
        {url && file.contentType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="h-full w-full object-contain" />
        ) : url && file.contentType.startsWith("video/") ? (
          <video src={url} controls className="h-full w-full" />
        ) : (
          <Icon className="h-12 w-12" style={{ color: fileColor(file) }} />
        )}
      </div>
      <div className="break-words text-[14px] text-[#eef1f6]">{file.name}</div>
      <div className="mt-1 text-[12px] text-[#5b9be0]">{file.contentType}</div>
      <div className="mt-4 w-full">
        <div className="flex justify-between border-t border-white/[0.07] py-2 text-[12.5px]">
          <span className="text-[#626875]">{t.sizeLabel}</span>
          <span className="text-[#c3c8d2]">{fmtSize(file.sizeBytes)}</span>
        </div>
        <div className="flex justify-between border-t border-white/[0.07] py-2 text-[12.5px]">
          <span className="text-[#626875]">{t.dateLabel}</span>
          <span className="text-[#c3c8d2]">{fmtDate(file.createdAt, lang)}</span>
        </div>
      </div>
    </div>
  )
}

function BottomPanel({
  tab,
  selected,
  descDraft,
  setDescDraft,
  onSaveDesc,
  onTogglePause,
  onArchive,
  onDelete,
  messages,
  draft,
  setDraft,
  onSend,
  t,
  lang,
}: {
  tab: BottomTab
  selected: Project
  descDraft: string
  setDescDraft: (v: string) => void
  onSaveDesc: () => void
  onTogglePause: () => void
  onArchive: () => void
  onDelete: () => void
  messages: ChatMessage[]
  draft: string
  setDraft: (v: string) => void
  onSend: () => void
  t: Dictionary
  lang: string
}) {
  if (tab === "desc") {
    return (
      <div className="max-w-[720px]">
        <div className="text-[11px] font-semibold tracking-[1.4px] text-[#5b9be0]">
          {t.descHeading}
        </div>
        <textarea
          value={descDraft}
          onChange={(e) => setDescDraft(e.target.value)}
          placeholder={t.descEmpty}
          rows={5}
          className="mt-2.5 w-full resize-y rounded-[10px] border border-white/10 bg-[#10151f] p-3 text-[14px] leading-relaxed text-[#c3c8d2] outline-none focus:border-[#2f80ed]"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="rounded-full border border-white/10 px-3 py-1 text-[12px] text-[#9aa0ac]">
            {t.createdLabel} {fmtDate(selected.createdAt, lang)}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-[12px] text-[#9aa0ac]">
            {t.updatedLabel} {fmtDate(selected.updatedAt, lang)}
          </span>
          <button
            type="button"
            onClick={onSaveDesc}
            className="ml-auto rounded-[9px] bg-[#1d6ff2] px-4 py-2 text-[13px] text-white hover:bg-[#175fd6]"
          >
            {t.saveDescription}
          </button>
        </div>
      </div>
    )
  }

  if (tab === "settings") {
    return (
      <div className="max-w-[640px]">
        <div className="flex items-center justify-between gap-4 py-3.5">
          <div>
            <div className="text-[14px]">{t.settingPauseTitle}</div>
            <div className="mt-1 text-[12px] text-[#626875]">
              {t.settingPauseDesc}
            </div>
          </div>
          <button
            type="button"
            onClick={onTogglePause}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full",
              selected.isPaused ? "bg-[#2f80ed]" : "bg-white/15",
            )}
          >
            <span
              className={cn(
                "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white transition-all",
                selected.isPaused ? "left-[22px]" : "left-[3px]",
              )}
            />
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/[0.07] pt-4">
          <button
            type="button"
            onClick={onArchive}
            className="flex items-center gap-2 rounded-[9px] border border-white/10 px-4 py-2 text-[13px] text-[#c3c8d2] hover:bg-white/5"
          >
            <Archive className="h-4 w-4" />
            {t.archiveProject}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-2 rounded-[9px] border border-[rgba(255,77,0,0.4)] px-4 py-2 text-[13px] text-[#ff8a60] hover:bg-[rgba(255,77,0,0.08)]"
          >
            <Trash2 className="h-4 w-4" />
            {t.deleteProject}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[160px] flex-col">
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[14px] text-[#626875]">
            {t.chatEmpty}
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.senderRole === "user"
            return (
              <div
                key={m.id}
                className={cn("flex", mine ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[72%] px-3.5 py-2.5 text-[13.5px] leading-snug",
                    mine
                      ? "rounded-[14px_14px_4px_14px] bg-[#1d6ff2] text-white"
                      : "rounded-[14px_14px_14px_4px] bg-[#10151f] text-[#eef1f6]",
                  )}
                >
                  {m.text}
                  <div
                    className={cn(
                      "mt-1 text-right text-[10.5px]",
                      mine ? "text-white/70" : "text-[#626875]",
                    )}
                  >
                    {fmtTime(m.createdAt)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="mt-3 flex shrink-0 items-center gap-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={t.chatPlaceholder}
          className="h-[42px] flex-1 rounded-[9px] border border-white/10 bg-[#10151f] px-3.5 text-[14px] outline-none focus:border-[#2f80ed]"
        />
        <button
          type="button"
          onClick={onSend}
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[9px] bg-[#1d6ff2] text-white hover:bg-[#175fd6]"
        >
          <Send className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

function MenuBtn({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[7px] px-2.5 py-2 text-left text-[13px] hover:bg-white/[0.07]",
        danger ? "text-[#ff8a60]" : "text-[#eef1f6]",
      )}
    >
      <span className="opacity-85">{icon}</span>
      {label}
    </button>
  )
}
