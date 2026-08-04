"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  Grid3X3,
  Image as ImageIcon,
  Link2,
  List,
  Loader2,
  MessageCircle,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Trash2,
  Upload,
  Video,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useI18n, type Dictionary } from "@/components/account/i18n"

type DriveFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  children?: DriveFile[]
}

type Project = {
  id: string
  name: string
  description: string
  groupName: "personal" | "shared" | "tools" | "archive"
  isPaused: boolean
  isActive?: boolean
  driveFolderId: string | null
  createdAt: string
  updatedAt: string
  unreadCount: number
}

type ChatMessage = {
  id: string
  senderType: "client" | "team" | "system"
  body: string
  createdAt: string
}

type ViewMode = "list" | "grid"
type Density = "compact" | "cozy"
type BottomTab = "desc" | "settings" | "chat"
type MobileTab = "files" | "desc" | "settings" | "chat"

type ContextMenu = {
  x: number
  y: number
  kind: "file" | "empty" | "project"
  file?: DriveFile
  projectId?: string
  /** When set, empty-menu / upload targets this Drive folder id. */
  parentId?: string
}

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

function fmtSize(bytes: number | null) {
  if (bytes == null) return "—"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtDate(iso: string | null, lang: string) {
  if (!iso) return "—"
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

function fileIcon(f: DriveFile) {
  if (f.isFolder) return Folder
  const ct = f.mimeType
  if (ct.startsWith("image/")) return ImageIcon
  if (ct.startsWith("video/")) return Video
  if (ct.startsWith("audio/")) return Music
  if (ct.includes("json") || ct.includes("text")) return FileText
  return FileText
}

function fileColor(f: DriveFile) {
  if (f.isFolder) return "#c9ccd3"
  if (f.mimeType.startsWith("image/")) return "#40c48a"
  if (f.mimeType.startsWith("video/")) return "#4a9be8"
  if (f.mimeType.startsWith("audio/")) return "#f0b73a"
  return "#8b93a3"
}

function driveOpenUrl(f: DriveFile) {
  return f.isFolder
    ? `https://drive.google.com/drive/folders/${f.id}`
    : `https://drive.google.com/file/d/${f.id}/view`
}

function findChildByName(files: DriveFile[], name: string) {
  const lower = name.toLowerCase()
  return files.find((f) => f.isFolder && f.name.toLowerCase() === lower) ?? null
}

/** Re-walk a path by id after a Drive tree refresh. */
function resolvePath(root: DriveFile[], oldPath: DriveFile[]): DriveFile[] {
  const next: DriveFile[] = []
  let children = root
  for (const node of oldPath) {
    const found = children.find((c) => c.id === node.id)
    if (!found || !found.isFolder) break
    next.push(found)
    children = found.children ?? []
  }
  return next
}

function mapProject(raw: Record<string, unknown>): Project {
  return {
    id: String(raw.id),
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    groupName: (raw.groupName as Project["groupName"]) ?? "personal",
    isPaused: Boolean(raw.isPaused ?? !raw.isActive),
    isActive: raw.isActive as boolean | undefined,
    driveFolderId: (raw.driveFolderId as string | null) ?? null,
    createdAt: String(raw.createdAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    unreadCount: Number(raw.unreadCount ?? 0),
  }
}

function uploadViaXhr(
  projectId: string,
  file: File,
  parentId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({
      fileName: file.name,
      parentId,
    })
    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/projects/${projectId}/media?${qs.toString()}`)
    xhr.withCredentials = true
    if (file.type) xhr.setRequestHeader("Content-Type", file.type)
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name))
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as { message?: string }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
          return
        }
        reject(new Error(data.message ?? `Upload failed (${xhr.status})`))
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`))
      }
    }
    xhr.onerror = () => reject(new Error("Network error during upload."))
    xhr.send(file)
  })
}

export function WorkspacePageClient() {
  const { t, lang } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadParentRef = useRef<string | null>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [query, setQuery] = useState("")
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {},
  )
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id"),
  )
  const [rootFiles, setRootFiles] = useState<DriveFile[]>([])
  const [driveFolderId, setDriveFolderId] = useState<string | null>(null)
  const [driveAvailable, setDriveAvailable] = useState(true)
  const [path, setPath] = useState<DriveFile[]>([])
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null)
  const [view, setView] = useState<ViewMode>("list")
  const [density, setDensity] = useState<Density>("compact")
  const [bottomTab, setBottomTab] = useState<BottomTab>("desc")
  const [mobileTab, setMobileTab] = useState<MobileTab>("files")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [descDraft, setDescDraft] = useState("")
  const [menu, setMenu] = useState<ContextMenu | null>(null)
  const [uploading, setUploading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [mobileShowProject, setMobileShowProject] = useState(false)
  /** Nested path inside IN / OUT panes (cozy mode). */
  const [inPath, setInPath] = useState<DriveFile[]>([])
  const [outPath, setOutPath] = useState<DriveFile[]>([])

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const currentItems = useMemo(
    () => (path.length ? (path[path.length - 1].children ?? []) : rootFiles),
    [path, rootFiles],
  )

  const currentParentId =
    path.length > 0
      ? path[path.length - 1].id
      : driveFolderId ?? selected?.driveFolderId ?? null

  const inFolder = useMemo(
    () => findChildByName(rootFiles, "IN"),
    [rootFiles],
  )
  const outFolder = useMemo(
    () => findChildByName(rootFiles, "OUT"),
    [rootFiles],
  )

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const res = await fetch("/api/projects")
      if (!res.ok) return
      const data = await res.json()
      const list = (data.projects ?? []).map(
        (p: Record<string, unknown>) => mapProject(p),
      )
      setProjects(list)
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadDrive = useCallback(
    async (projectId: string, keepPath = true) => {
      setLoadingFiles(true)
      try {
        const res = await fetch(`/api/projects/${projectId}/drive`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.message ?? "Failed")
          return
        }
        const data = await res.json()
        if (!data.available) {
          setDriveAvailable(false)
          setRootFiles([])
          setDriveFolderId(null)
          setPath([])
          setInPath([])
          setOutPath([])
          toast.error(t.driveUnavailable)
          return
        }
        setDriveAvailable(true)
        const files: DriveFile[] = data.files ?? []
        setRootFiles(files)
        setDriveFolderId(data.driveFolderId ?? null)
        setProjects((prev) =>
          prev.map((p) =>
            p.id === projectId
              ? { ...p, driveFolderId: data.driveFolderId ?? p.driveFolderId }
              : p,
          ),
        )
        if (keepPath) {
          setPath((prev) => resolvePath(files, prev))
          setInPath((prev) => {
            const inn = findChildByName(files, "IN")
            return inn ? resolvePath(inn.children ?? [], prev) : []
          })
          setOutPath((prev) => {
            const out = findChildByName(files, "OUT")
            return out ? resolvePath(out.children ?? [], prev) : []
          })
        } else {
          setPath([])
          setInPath([])
          setOutPath([])
        }
        setSelectedFile(null)
      } finally {
        setLoadingFiles(false)
      }
    },
    [t.driveUnavailable],
  )

  const loadMessages = useCallback(async (projectId: string) => {
    const res = await fetch(`/api/projects/${projectId}/chat`)
    if (!res.ok) return
    const data = await res.json()
    const list = (data.messages ?? []).map(
      (m: {
        id: string
        senderType: ChatMessage["senderType"]
        body: string
        createdAt: string
      }) => ({
        id: m.id,
        senderType: m.senderType,
        body: m.body,
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : new Date(m.createdAt).toISOString(),
      }),
    )
    setMessages(list)
    void fetch(`/api/projects/${projectId}/chat/read`, { method: "POST" }).catch(
      () => undefined,
    )
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
      setRootFiles([])
      setPath([])
      setInPath([])
      setOutPath([])
      setSelectedFile(null)
      setMessages([])
      setDriveFolderId(null)
      setDriveAvailable(true)
      return
    }
    void loadDrive(selectedId, false)
  }, [selectedId, loadDrive])

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
    setInPath([])
    setOutPath([])
    setSelectedFile(null)
    setDraft("")
    setMobileShowProject(true)
    router.replace(`/account/projects?id=${id}`, { scroll: false })
  }

  const createProject = async () => {
    if (creating) return
    const name =
      lang === "ru"
        ? `Новый проект ${projects.length + 1}`
        : `New project ${projects.length + 1}`
    setCreating(true)
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(
          typeof data?.message === "string" ? data.message : t.createFailed,
        )
        return
      }
      await loadProjects()
      selectProject(data.project.id)
    } finally {
      setCreating(false)
    }
  }

  const patchProject = async (id: string, body: Record<string, unknown>) => {
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
      prev.map((p) =>
        p.id === id ? { ...p, ...mapProject({ ...p, ...data.project }) } : p,
      ),
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
    const res = await fetch(`/api/projects/${selectedId}/chat`, {
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
    const m = data.message
    setMessages((prev) => [
      ...prev,
      {
        id: m.id,
        senderType: m.senderType ?? "client",
        body: m.body ?? text,
        createdAt:
          typeof m.createdAt === "string"
            ? m.createdAt
            : new Date(m.createdAt ?? Date.now()).toISOString(),
      },
    ])
  }

  const openFolder = (file: DriveFile) => {
    if (!file.isFolder) return
    setPath((p) => [...p, file])
    setSelectedFile(null)
  }

  const goCrumb = (idx: number) => {
    setPath((p) => (idx < 0 ? [] : p.slice(0, idx + 1)))
    setSelectedFile(null)
  }

  const createFolder = async (parentId: string | null) => {
    if (!selectedId || !parentId) return
    const name = prompt(t.folderNamePrompt)
    if (!name?.trim()) return
    const res = await fetch(`/api/projects/${selectedId}/drive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), parentId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.message ?? "Failed")
      return
    }
    await loadDrive(selectedId, true)
  }

  const renameItem = async (file: DriveFile) => {
    if (!selectedId) return
    const name = prompt(t.renamePrompt, file.name)
    if (!name?.trim() || name.trim() === file.name) return
    const res = await fetch(
      `/api/projects/${selectedId}/drive/files/${file.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      },
    )
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast.error(data.message ?? "Failed")
      return
    }
    await loadDrive(selectedId, true)
  }

  const deleteItem = async (file: DriveFile) => {
    if (!selectedId) return
    if (!confirm(t.confirmDelete)) return
    const res = await fetch(
      `/api/projects/${selectedId}/drive/files/${file.id}`,
      { method: "DELETE" },
    )
    if (!res.ok) {
      toast.error("Failed")
      return
    }
    if (selectedFile?.id === file.id) setSelectedFile(null)
    await loadDrive(selectedId, true)
  }

  const shareItem = async (file: DriveFile) => {
    const url = driveOpenUrl(file)
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t.mShare)
    } catch {
      toast.error("Failed")
    }
  }

  const uploadFiles = async (
    fileList: FileList | File[],
    parentId: string | null,
  ) => {
    if (!selectedId || !parentId) return
    const list = Array.from(fileList)
    if (!list.length) return
    setUploading(true)
    try {
      for (const file of list) {
        try {
          await uploadViaXhr(selectedId, file, parentId)
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : `Upload failed: ${file.name}`,
          )
        }
      }
      await loadDrive(selectedId, true)
    } finally {
      setUploading(false)
    }
  }

  const triggerUpload = (parentId: string | null) => {
    uploadParentRef.current = parentId
    fileInputRef.current?.click()
  }

  const openContext = (
    e: React.MouseEvent,
    kind: ContextMenu["kind"],
    extra?: Partial<ContextMenu>,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 280),
      kind,
      ...extra,
    })
  }

  const crumbs = [
    { name: t.projectRoot, idx: -1 },
    ...path.map((n, i) => ({ name: n.name, idx: i })),
  ]

  const clearSelection = () => {
    setSelectedId(null)
    setMobileShowProject(false)
    router.replace("/account/projects", { scroll: false })
  }

  const showMobileList = !mobileShowProject
  const showMobileProject = mobileShowProject && selected

  const projectsColumn = (
    <section className="flex h-full min-h-0 flex-col bg-[#0a0e16]">
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
                    setCollapsedGroups((c) => ({ ...c, [g.name]: open }))
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
          onClick={() => void createProject()}
          disabled={creating}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-[9px] bg-[#1d6ff2] text-[14px] font-medium text-white hover:bg-[#175fd6] disabled:opacity-60"
        >
          <Plus className="h-[18px] w-[18px]" />
          {creating ? t.creatingProject : t.newProject}
        </button>
      </div>
    </section>
  )

  const bottomPanelProps = selected
    ? {
        selected,
        descDraft,
        setDescDraft,
        onSaveDesc: saveDescription,
        onTogglePause: () =>
          void patchProject(selected.id, { isPaused: !selected.isPaused }),
        onArchive: () =>
          void patchProject(selected.id, { groupName: "archive" }),
        onDelete: () => void deleteProject(selected.id),
        messages,
        draft,
        setDraft,
        onSend: sendMessage,
        t,
        lang,
      }
    : null

  const fileBrowser = (
    parentId: string | null,
    items: DriveFile[],
    opts: {
      mode: ViewMode
      crumbs?: { name: string; idx: number }[]
      onCrumb?: (idx: number) => void
      onOpenFolder: (f: DriveFile) => void
      showPreview?: boolean
    },
  ) => (
    <div
      className="relative flex min-h-0 flex-1 overflow-hidden rounded-[14px] border border-white/10 bg-[hsl(226_26%_9.5%)]"
      onContextMenu={(e) => openContext(e, "empty", { parentId: parentId ?? undefined })}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer.files.length)
          void uploadFiles(e.dataTransfer.files, parentId)
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {opts.crumbs && opts.onCrumb && (
          <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.07] px-3 py-2">
            {opts.crumbs.map((c, i) => (
              <span key={`${c.name}-${i}`} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => opts.onCrumb!(c.idx)}
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[12px]",
                    i === opts.crumbs!.length - 1
                      ? "text-[#c3c8d2]"
                      : "text-[#626875] hover:bg-white/5",
                  )}
                >
                  {c.name}
                </button>
                {i < opts.crumbs!.length - 1 && (
                  <span className="text-[12px] text-[#3a4050]">/</span>
                )}
              </span>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
          {loadingFiles ? (
            <div className="flex justify-center py-16 text-[#626875]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : !driveAvailable ? (
            <div className="flex h-full min-h-[140px] items-center justify-center text-[12.5px] text-[#4a5060]">
              {t.driveUnavailable}
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full min-h-[140px] items-center justify-center text-[12.5px] text-[#4a5060]">
              {t.emptyFolder}
            </div>
          ) : opts.mode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3">
              {items.map((f) => (
                <FileButton
                  key={f.id}
                  file={f}
                  selected={selectedFile?.id === f.id}
                  mode="grid"
                  lang={lang}
                  onOpen={() =>
                    f.isFolder ? opts.onOpenFolder(f) : setSelectedFile(f)
                  }
                  onContext={(e) => openContext(e, "file", { file: f })}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {items.map((f) => (
                <FileButton
                  key={f.id}
                  file={f}
                  selected={selectedFile?.id === f.id}
                  mode="list"
                  lang={lang}
                  onOpen={() =>
                    f.isFolder ? opts.onOpenFolder(f) : setSelectedFile(f)
                  }
                  onContext={(e) => openContext(e, "file", { file: f })}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {opts.showPreview && (
        <div className="hidden w-[264px] shrink-0 overflow-y-auto border-l border-white/[0.07] bg-[#0a0e16] p-[18px] xl:block">
          {selectedFile && !selectedFile.isFolder && selectedId ? (
            <PreviewPane
              file={selectedFile}
              projectId={selectedId}
              t={t}
              lang={lang}
            />
          ) : (
            <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2.5 text-center text-[#4a5060]">
              <FolderOpen className="h-[34px] w-[34px]" />
              <span className="text-[12.5px]">{t.previewEmpty}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )

  const cozyPane = (
    label: string,
    sub: string,
    folder: DriveFile | null,
    nestedPath: DriveFile[],
    setNestedPath: (fn: (p: DriveFile[]) => DriveFile[]) => void,
  ) => {
    const parent =
      nestedPath.length > 0
        ? nestedPath[nestedPath.length - 1]
        : folder
    const items = parent?.children ?? []
    const parentId = parent?.id ?? null
    const paneCrumbs = folder
      ? [
          { name: label, idx: -1 },
          ...nestedPath.map((n, i) => ({ name: n.name, idx: i })),
        ]
      : []

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden px-1">
        <div className="mb-2 shrink-0 px-1">
          <div className="text-[13px] font-semibold tracking-wide text-[#5b9be0]">
            {label}
          </div>
          <div className="mt-0.5 text-[11.5px] text-[#626875]">{sub}</div>
        </div>
        {!folder ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-[14px] border border-dashed border-white/10 text-[12.5px] text-[#4a5060]">
            {t.driveEmpty}
          </div>
        ) : (
          <>
            <div className="mb-2 flex shrink-0 gap-2 px-1">
              <button
                type="button"
                onClick={() => void createFolder(parentId)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11.5px] text-[#c3c8d2] hover:bg-white/5"
              >
                {t.mNewFolder}
              </button>
              <button
                type="button"
                onClick={() => triggerUpload(parentId)}
                disabled={uploading}
                className="flex items-center gap-1 rounded-lg bg-[#1d6ff2] px-2.5 py-1 text-[11.5px] text-white hover:bg-[#175fd6] disabled:opacity-60"
              >
                {uploading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                {t.upload}
              </button>
            </div>
            {fileBrowser(parentId, items, {
              mode: "list",
              crumbs: paneCrumbs,
              onCrumb: (idx) =>
                setNestedPath((p) => (idx < 0 ? [] : p.slice(0, idx + 1))),
              onOpenFolder: (f) =>
                setNestedPath((p) => [...p, f]),
              showPreview: false,
            })}
          </>
        )}
      </div>
    )
  }

  const renderProjectMain = (variant: "desktop" | "mobile") => {
    if (!selected || !bottomPanelProps) return null
    return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={clearSelection}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-white/10 bg-[#0d121c] text-[#9aa0ac] hover:bg-[#151d2b] hover:text-[#eef1f6]"
          >
            <ArrowLeft className="h-[19px] w-[19px]" />
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="hidden rounded-lg px-2 py-1 text-[16px] font-medium text-[#9aa0ac] hover:bg-white/5 hover:text-[#eef1f6] sm:inline"
          >
            {t.allProjectsCrumb}
          </button>
          <span className="hidden text-[16px] text-[#3a4050] sm:inline">/</span>
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
        <div className="flex items-center gap-2 md:gap-3">
          <div className="flex gap-0.5 rounded-[9px] border border-white/10 bg-[#10151f] p-[3px]">
            {(
              [
                ["compact", t.compact],
                ["cozy", t.cozy],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDensity(mode)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[12px]",
                  density === mode
                    ? "bg-[rgba(45,131,206,0.35)] text-[#eef1f6]"
                    : "text-[#8b909c] hover:text-[#eef1f6]",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {density === "compact" && (
            <div className="hidden gap-0.5 rounded-[9px] border border-white/10 bg-[#10151f] p-[3px] md:flex">
              {(
                [
                  ["list", List, t.viewList],
                  ["grid", Grid3X3, t.viewGrid],
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
          )}
          <button
            type="button"
            onClick={() => selectedId && void loadDrive(selectedId, true)}
            className="hidden items-center gap-1.5 text-[13px] text-[#c3c8d2] hover:text-[#eef1f6] md:flex"
          >
            <RefreshCw className="h-[18px] w-[18px]" />
            {t.refresh}
          </button>
        </div>
      </div>

      {/* Desktop: resizable files + bottom */}
      {variant === "desktop" && (
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ResizablePanelGroup direction="vertical" className="h-full">
          <ResizablePanel defaultSize={58} minSize={20}>
            <div className="flex h-full min-h-0 flex-col px-2.5 pb-2 pt-4 md:px-6">
              {density === "cozy" ? (
                <ResizablePanelGroup direction="horizontal" className="h-full">
                  <ResizablePanel defaultSize={50} minSize={25}>
                    {cozyPane("IN", t.paneInSub, inFolder, inPath, setInPath)}
                  </ResizablePanel>
                  <ResizableHandle
                    withHandle
                    className="mx-1 bg-white/10"
                  />
                  <ResizablePanel defaultSize={50} minSize={25}>
                    {cozyPane("OUT", t.paneOutSub, outFolder, outPath, setOutPath)}
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {crumbs.map((c, i) => (
                        <span
                          key={`${c.name}-${i}`}
                          className="flex items-center gap-1"
                        >
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
                        onClick={() => void createFolder(currentParentId)}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-[12px] text-[#c3c8d2] hover:bg-white/5"
                      >
                        {t.mNewFolder}
                      </button>
                      <button
                        type="button"
                        onClick={() => triggerUpload(currentParentId)}
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
                  {fileBrowser(currentParentId, currentItems, {
                    mode: view,
                    onOpenFolder: openFolder,
                    showPreview: true,
                  })}
                </>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-white/10" />
          <ResizablePanel defaultSize={42} minSize={20}>
            <div className="relative mx-2.5 mb-3 flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border border-white/10 bg-[hsl(226_26%_9.5%)] md:mx-6">
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
                <BottomPanel tab={bottomTab} {...bottomPanelProps} />
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      )}

      {/* Mobile project body */}
      {variant === "mobile" && (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mobileTab === "files" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {density === "cozy" ? (
              <div className="flex flex-col gap-4">
                {cozyPane("IN", t.paneInSub, inFolder, inPath, setInPath)}
                {cozyPane("OUT", t.paneOutSub, outFolder, outPath, setOutPath)}
              </div>
            ) : (
              <>
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
                    onClick={() => triggerUpload(currentParentId)}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1d6ff2] py-2.5 text-[14px] text-white"
                  >
                    <Upload className="h-4 w-4" />
                    {t.upload}
                  </button>
                  <button
                    type="button"
                    onClick={() => void createFolder(currentParentId)}
                    className="rounded-xl border border-white/10 px-3 py-2.5 text-[14px] text-[#c3c8d2]"
                  >
                    <Folder className="h-4 w-4" />
                  </button>
                </div>
                {currentItems.length === 0 ? (
                  <div className="py-10 text-center text-[13px] text-[#4a5060]">
                    {!driveAvailable ? t.driveUnavailable : t.emptyFolder}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {currentItems.map((f) => (
                      <FileButton
                        key={f.id}
                        file={f}
                        selected={selectedFile?.id === f.id}
                        mode="list"
                        lang={lang}
                        onOpen={() =>
                          f.isFolder ? openFolder(f) : setSelectedFile(f)
                        }
                        onContext={(e) => openContext(e, "file", { file: f })}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {mobileTab !== "files" && (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <BottomPanel
              tab={
                mobileTab === "desc"
                  ? "desc"
                  : mobileTab === "settings"
                    ? "settings"
                    : "chat"
              }
              {...bottomPanelProps}
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
      )}
    </>
    )
  }

  const emptyDesktop = (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
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
              onClick={() => void createProject()}
              disabled={creating}
              className="flex h-[52px] items-center gap-2 rounded-xl bg-[#1d6ff2] px-[22px] text-[15px] font-medium text-white hover:bg-[#3b8bf0] disabled:opacity-60"
            >
              <Plus className="h-5 w-5" />
              {creating ? t.creatingProject : t.newProject}
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
                <span className="text-[13px] text-[#4a5060]">{g.items.length}</span>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-3">
                {g.items.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectProject(p.id)}
                    className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[hsl(226_26%_9.5%)] p-[22px] text-left hover:border-white/[0.18] hover:bg-[hsl(226_26%_11%)]"
                  >
                    <div className="flex h-[46px] w-[46px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
                      <FolderOpen className="h-[22px] w-[22px] text-[#8b909c]" />
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
  )

  return (
    <div className="flex h-full min-w-0 overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            void uploadFiles(
              e.target.files,
              uploadParentRef.current ?? currentParentId,
            )
          }
          e.target.value = ""
        }}
      />

      {/* Desktop: resizable projects | main */}
      <div className="hidden h-full min-w-0 flex-1 lg:flex">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={22} minSize={15} maxSize={40}>
            <div className="h-full border-r border-white/[0.08]">
              {projectsColumn}
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-white/10" />
          <ResizablePanel defaultSize={78} minSize={40}>
            <main className="flex h-full min-w-0 flex-col overflow-hidden">
              {selected ? renderProjectMain("desktop") : emptyDesktop}
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Mobile */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:hidden">
        {showMobileList && (
          <>
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
                  onClick={() => void createProject()}
                  disabled={creating}
                  className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl bg-[#1d6ff2] text-white disabled:opacity-60"
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
                        setCollapsedGroups((c) => ({ ...c, [g.name]: open }))
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
          </>
        )}
        {showMobileProject && (
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {renderProjectMain("mobile")}
          </main>
        )}
      </div>

      {menu && (
        <div
          className="fixed z-[120] min-w-[216px] rounded-[11px] border border-white/10 bg-[#131926] p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.kind === "file" && menu.file && (
            <>
              {!menu.file.isFolder && (
                <MenuBtn
                  icon={<Download className="h-[18px] w-[18px]" />}
                  label={t.mDownload}
                  onClick={() => {
                    if (selectedId) {
                      window.open(
                        `/api/projects/${selectedId}/drive/files/${menu.file!.id}`,
                        "_blank",
                      )
                    }
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
                icon={<Link2 className="h-[18px] w-[18px]" />}
                label={t.mShare}
                onClick={() => {
                  void shareItem(menu.file!)
                  setMenu(null)
                }}
              />
              <MenuBtn
                icon={<ExternalLink className="h-[18px] w-[18px]" />}
                label={t.mOpenDrive}
                onClick={() => {
                  window.open(driveOpenUrl(menu.file!), "_blank")
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
                  void createFolder(menu.parentId ?? currentParentId)
                  setMenu(null)
                }}
              />
              <MenuBtn
                icon={<Upload className="h-[18px] w-[18px]" />}
                label={t.mUploadFile}
                onClick={() => {
                  triggerUpload(menu.parentId ?? currentParentId)
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
              {(() => {
                const proj = projects.find((p) => p.id === menu.projectId)
                if (!proj?.driveFolderId) return null
                return (
                  <MenuBtn
                    icon={<ExternalLink className="h-[18px] w-[18px]" />}
                    label={t.mOpenDrive}
                    onClick={() => {
                      window.open(
                        `https://drive.google.com/drive/folders/${proj.driveFolderId}`,
                        "_blank",
                      )
                      setMenu(null)
                    }}
                  />
                )
              })()}
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
  file: DriveFile
  selected: boolean
  mode: "list" | "grid"
  lang: string
  onOpen: () => void
  onContext: (e: React.MouseEvent) => void
}) {
  const Icon = fileIcon(f)
  const color = fileColor(f)
  const date = f.modifiedAt ?? f.createdAt
  const meta = f.isFolder
    ? "folder"
    : `${fmtSize(f.sizeBytes)} · ${fmtDate(date, lang)}`

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
  projectId,
  t,
  lang,
}: {
  file: DriveFile
  projectId: string
  t: Dictionary
  lang: string
}) {
  const Icon = fileIcon(file)
  const url = `/api/projects/${projectId}/drive/files/${file.id}`
  const date = file.modifiedAt ?? file.createdAt
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-3.5 flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-[10px] border border-white/10 bg-[#10151f]">
        {file.mimeType.startsWith("image/") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.name} className="h-full w-full object-contain" />
        ) : file.mimeType.startsWith("video/") ? (
          <video src={url} controls className="h-full w-full" />
        ) : (
          <Icon className="h-12 w-12" style={{ color: fileColor(file) }} />
        )}
      </div>
      <div className="break-words text-[14px] text-[#eef1f6]">{file.name}</div>
      <div className="mt-1 text-[12px] text-[#5b9be0]">{file.mimeType}</div>
      <div className="mt-4 w-full">
        <div className="flex justify-between border-t border-white/[0.07] py-2 text-[12.5px]">
          <span className="text-[#626875]">{t.sizeLabel}</span>
          <span className="text-[#c3c8d2]">{fmtSize(file.sizeBytes)}</span>
        </div>
        <div className="flex justify-between border-t border-white/[0.07] py-2 text-[12.5px]">
          <span className="text-[#626875]">{t.dateLabel}</span>
          <span className="text-[#c3c8d2]">{fmtDate(date, lang)}</span>
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
            const mine = m.senderType === "client"
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
                      : m.senderType === "system"
                        ? "rounded-[14px] bg-white/[0.04] text-[#9aa0ac]"
                        : "rounded-[14px_14px_14px_4px] bg-[#10151f] text-[#eef1f6]",
                  )}
                >
                  {m.body}
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
