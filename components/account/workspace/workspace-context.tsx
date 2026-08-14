"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

import {
  tf,
  useI18n,
  type Dictionary,
  type Lang,
} from "@/components/account/i18n"
import { uploadProjectFileDirect } from "@/lib/project-direct-upload"
import {
  findChildByName,
  itemsAtPath,
  mapProject,
  pathToFolderPath,
  resolvePath,
} from "./format"
import { CABINET_SOURCE } from "./source"
import type {
  BottomTab,
  ChatMessage,
  Clipboard,
  ClipboardOp,
  ContextMenuKind,
  ContextMenuState,
  Density,
  DriveFile,
  Project,
  UploadTarget,
  ViewMode,
  WorkspaceSource,
} from "./types"

const DENSITY_KEY = "ffworks-ws-density"
const VIEW_KEY = "ffworks-ws-view"
const DELTA_INTERVAL_MS = 4000

/**
 * Раздел списка проектов. Живёт в URL (`?tab=…`), потому что в боковом меню
 * это обычные ссылки, а не состояние страницы.
 */
export type ProjectTab = "projects" | "shared" | "tools" | "archive" | "trash"

const PROJECT_TABS: ProjectTab[] = [
  "projects",
  "shared",
  "tools",
  "archive",
  "trash",
]

function parseTab(raw: string | null): ProjectTab {
  return PROJECT_TABS.includes(raw as ProjectTab)
    ? (raw as ProjectTab)
    : "projects"
}

/** Событие «список проектов изменился» — по нему шелл обновляет счётчики. */
export const PROJECTS_CHANGED_EVENT = "ffworks:projects-changed"

function notifyProjectsChanged() {
  window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT))
}

type PromptRequest = {
  title: string
  label: string
  initial: string
  confirmLabel: string
  onSubmit: (value: string) => void
}

type ConfirmRequest = {
  title: string
  description?: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => void
}

type WorkspaceValue = {
  t: Dictionary
  lang: Lang

  /**
   * Откуда пришли данные и что разрешено. Компоненты смотрят сюда, чтобы
   * решить, рисовать ли кнопку («создать проект» есть в кабинете и нет в
   * админке) и с какой стороны показывать сообщения чата.
   */
  source: WorkspaceSource

  // проекты
  projects: Project[]
  /** Плоский список проектов текущего раздела с учётом поиска. */
  visibleProjects: Project[]
  /** Сколько проектов в каждом разделе — для чисел в боковом меню. */
  counts: Record<ProjectTab, number>
  projectTab: ProjectTab
  setProjectTab: (tab: ProjectTab) => void
  loadingProjects: boolean
  query: string
  setQuery: (v: string) => void
  selectedId: string | null
  selected: Project | null
  selectProject: (id: string) => void
  clearSelection: () => void
  creating: boolean
  createProject: () => void
  renameProject: (project: Project) => void
  patchProject: (id: string, body: Record<string, unknown>) => Promise<void>
  setArchived: (project: Project, archived: boolean) => void
  deleteProject: (id: string) => void

  // хранилище
  rootFiles: DriveFile[]
  driveAvailable: boolean
  loadingFiles: boolean
  refreshDrive: () => void
  inFolder: DriveFile | null
  outFolder: DriveFile | null

  // навигация по дереву (полный режим)
  path: DriveFile[]
  currentItems: DriveFile[]
  currentTarget: UploadTarget
  openFolder: (f: DriveFile) => void
  goToCrumb: (index: number) => void
  goToPath: (nodes: DriveFile[]) => void

  // выделение файлов
  /** Всё выделенное; последний элемент — тот, что показан в превью. */
  selection: DriveFile[]
  /** Последний выделенный — источник для панели превью. */
  selectedFile: DriveFile | null
  isSelected: (id: string) => boolean
  /** Клик по элементу: с Cmd/Ctrl добавляет к выделению, без — заменяет. */
  selectFile: (file: DriveFile, additive?: boolean) => void
  /** Shift-клик: диапазон от опорного элемента до указанного включительно. */
  selectRange: (list: DriveFile[], file: DriveFile) => void
  setSelectedFile: (f: DriveFile | null) => void
  clearFileSelection: () => void

  // режимы отображения
  density: Density
  setDensity: (d: Density) => void
  view: ViewMode
  setView: (v: ViewMode) => void
  bottomTab: BottomTab
  setBottomTab: (tab: BottomTab) => void

  // операции с файлами
  uploading: boolean
  createFolder: (target: UploadTarget) => void
  renameItem: (file: DriveFile) => void
  deleteItem: (file: DriveFile) => void
  /** Удаление всего выделения одним подтверждением. */
  deleteItems: (files: DriveFile[]) => void
  downloadItem: (file: DriveFile) => void
  uploadFiles: (list: FileList | File[], target: UploadTarget) => Promise<void>
  triggerUpload: (target: UploadTarget) => void
  createTextFile: (target: UploadTarget) => void
  triggerFolderUpload: (target: UploadTarget) => void
  shareProject: (project: Project) => void
  shareTarget: Project | null
  closeShareDialog: () => void
  restoreProject: (project: Project) => void

  // перемещение
  /** Элементы, для которых открыт диалог выбора папки назначения. */
  moveTargets: DriveFile[] | null
  openMoveDialog: (items: DriveFile[]) => void
  closeMoveDialog: () => void
  /** Перенос внутри проекта: меняется только логический путь. */
  moveItems: (items: DriveFile[], destFolderPath: string) => Promise<void>

  // буфер обмена
  clipboard: Clipboard | null
  /** Положить выделение в буфер: «Вырезать» или «Скопировать». */
  putToClipboard: (op: ClipboardOp, items: DriveFile[]) => void
  removeFromClipboard: (id: string) => void
  clearClipboard: () => void
  /** Вставить буфер в папку: «вырезать» переносит, «копировать» ждёт бэкенд. */
  pasteClipboard: (destFolderPath: string) => void
  /** Элемент помечен «вырезать» — показываем его приглушённым. */
  isCut: (id: string) => boolean

  // контекстное меню
  menu: ContextMenuState | null
  openMenu: (
    kind: ContextMenuKind,
    event: React.MouseEvent,
    extra?: Partial<ContextMenuState>,
  ) => void
  closeMenu: () => void

  // описание и чат
  descDraft: string
  setDescDraft: (v: string) => void
  saveDescription: () => void
  messages: ChatMessage[]
  draft: string
  setDraft: (v: string) => void
  sendMessage: () => void
  openChat: (projectId: string) => void

  // диалоги
  prompt: PromptRequest | null
  setPrompt: (r: PromptRequest | null) => void
  confirm: ConfirmRequest | null
  setConfirm: (r: ConfirmRequest | null) => void

  notImplemented: () => void
}

const Ctx = createContext<WorkspaceValue | null>(null)

export function useWorkspace() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider")
  return ctx
}

async function uploadViaXhr(
  source: WorkspaceSource,
  projectId: string,
  file: File,
  target: UploadTarget,
): Promise<void> {
  // Кабинет — через storage v1 (presign → PUT → notify). Админский конвейер
  // и другие источники ходят на свой uploadUrl (прокси байтов через Next).
  if (source.scopeKey === "cabinet") {
    await uploadProjectFileDirect({
      projectId,
      file,
      folderPath: target.folderPath ?? "",
    })
    return
  }
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ fileName: file.name })
    if (target.parentId) qs.set("parentId", target.parentId)
    else qs.set("folderPath", target.folderPath ?? "")
    const xhr = new XMLHttpRequest()
    xhr.open("POST", source.uploadUrl(projectId, qs))
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

export function WorkspaceProvider({
  children,
  source = CABINET_SOURCE,
}: {
  children: React.ReactNode
  /**
   * Откуда брать данные и что разрешено. По умолчанию кабинет, поэтому
   * /account/projects работает как раньше; админский «Конвейер» передаёт свой.
   */
  source?: WorkspaceSource
}) {
  const { t, lang } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetRef = useRef<UploadTarget>({ parentId: null, folderPath: "" })
  const storageCursorRef = useRef(0)

  /**
   * Словарь в ref: загрузчики берут строки отсюда, а не из замыкания.
   * Иначе смена языка меняла identity loadDrive и перезапускала эффекты —
   * дерево файлов перечитывалось на каждое переключение RU/EN.
   */
  const tRef = useRef(t)
  tRef.current = t

  /**
   * Источник тоже в ref, и по той же причине: загрузчики объявлены с пустым
   * списком зависимостей, а объект-источник может пересоздаваться на каждый
   * рендер родителя. Через ref его смена не перезапускает эффекты и не
   * перечитывает дерево файлов.
   */
  const sourceRef = useRef(source)
  sourceRef.current = source

  const [projects, setProjects] = useState<Project[]>([])
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("id"),
  )

  /**
   * Вкладка списка живёт в URL (`?tab=archive`), а не в состоянии:
   * пункт «Архив» в боковом меню — обычная ссылка, и подсветка меню,
   * список проектов и кнопка «назад» остаются согласованными.
   */
  const projectTab: ProjectTab = parseTab(searchParams.get("tab"))

  const buildUrl = useCallback(
    (id: string | null, tab: ProjectTab) =>
      sourceRef.current.pageUrl({ id, tab }),
    [],
  )

  const setProjectTab = useCallback(
    (tab: ProjectTab) => {
      router.replace(buildUrl(selectedId, tab), { scroll: false })
    },
    [router, buildUrl, selectedId],
  )

  const [rootFiles, setRootFiles] = useState<DriveFile[]>([])
  const [driveAvailable, setDriveAvailable] = useState(true)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [path, setPath] = useState<DriveFile[]>([])
  /**
   * Выделение — список, а не один файл: Cmd/Ctrl добавляет элементы.
   * Последний элемент считается активным и показывается в превью.
   */
  const [selection, setSelection] = useState<DriveFile[]>([])

  const selectedFile = selection.length ? selection[selection.length - 1] : null

  const setSelectedFile = useCallback((file: DriveFile | null) => {
    setSelection(file ? [file] : [])
  }, [])

  const clearFileSelection = useCallback(() => setSelection([]), [])

  const isSelected = useCallback(
    (id: string) => selection.some((f) => f.id === id),
    [selection],
  )

  /** Опора для Shift-диапазона: последний клик без Shift. */
  const anchorRef = useRef<DriveFile | null>(null)

  const selectFile = useCallback((file: DriveFile, additive = false) => {
    anchorRef.current = file
    setSelection((prev) => {
      if (!additive) return [file]
      const without = prev.filter((f) => f.id !== file.id)
      // повторный Cmd/Ctrl-клик по выделенному — снимает выделение
      return without.length === prev.length ? [...prev, file] : without
    })
  }, [])

  const selectRange = useCallback((list: DriveFile[], file: DriveFile) => {
    const anchor = anchorRef.current
    const to = list.findIndex((f) => f.id === file.id)
    const from = anchor ? list.findIndex((f) => f.id === anchor.id) : -1
    // Опоры нет или она в другой папке — ведём себя как обычный клик.
    if (from === -1 || to === -1) {
      anchorRef.current = file
      setSelection([file])
      return
    }
    const [start, end] = from <= to ? [from, to] : [to, from]
    setSelection(list.slice(start, end + 1))
  }, [])

  const [density, setDensityState] = useState<Density>("full")
  const [view, setViewState] = useState<ViewMode>("list")
  const [bottomTab, setBottomTab] = useState<BottomTab>("desc")

  const [uploading, setUploading] = useState(false)
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [moveTargets, setMoveTargets] = useState<DriveFile[] | null>(null)
  const [shareTarget, setShareTarget] = useState<Project | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [descDraft, setDescDraft] = useState("")
  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const notImplemented = useCallback(() => {
    toast.message(t.notImplemented)
  }, [t.notImplemented])

  // ---------- предпочтения режима ----------

  useEffect(() => {
    const d = window.localStorage.getItem(DENSITY_KEY)
    if (d === "full" || d === "simple") setDensityState(d)
    const v = window.localStorage.getItem(VIEW_KEY)
    if (v === "list" || v === "grid" || v === "columns") setViewState(v)
  }, [])

  const setDensity = useCallback((d: Density) => {
    setDensityState(d)
    window.localStorage.setItem(DENSITY_KEY, d)
  }, [])

  const setView = useCallback((v: ViewMode) => {
    setViewState(v)
    window.localStorage.setItem(VIEW_KEY, v)
  }, [])

  // ---------- загрузка данных ----------

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true)
    try {
      const res = await fetch(sourceRef.current.projectsUrl())
      if (!res.ok) return
      const data = await res.json()
      setProjects(
        (data.projects ?? []).map((p: Record<string, unknown>) => mapProject(p)),
      )
      notifyProjectsChanged()
    } finally {
      setLoadingProjects(false)
    }
  }, [])

  const loadDrive = useCallback(
    async (projectId: string, keepPath = true) => {
      setLoadingFiles(true)
      try {
        const res = await fetch(sourceRef.current.driveUrl(projectId))
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error(data.message ?? "Failed")
          return
        }
        const data = await res.json()
        if (!data.available) {
          setDriveAvailable(false)
          setRootFiles([])
          setPath([])
          toast.error(tRef.current.driveUnavailable)
          return
        }
        setDriveAvailable(true)
        const files: DriveFile[] = data.files ?? []
        setRootFiles(files)
        setPath((prev) => (keepPath ? resolvePath(files, prev) : []))
        setSelectedFile(null)

        const cursorRes = await fetch(sourceRef.current.treeCursorUrl(projectId))
        if (cursorRes.ok) {
          const cursorData = await cursorRes.json()
          if (typeof cursorData.cursor === "number") {
            storageCursorRef.current = cursorData.cursor
          }
        }
      } finally {
        setLoadingFiles(false)
      }
    },
    [],
  )

  const loadMessages = useCallback(async (projectId: string) => {
    const res = await fetch(sourceRef.current.chatUrl(projectId))
    if (!res.ok) return
    const data = await res.json()
    const list: ChatMessage[] = (data.messages ?? []).map(
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
    // Отметка «прочитано» есть только у пользователя: со стороны команды такого
    // признака в схеме нет, поэтому в админке шаг просто пропускается.
    const chatReadUrl = sourceRef.current.chatReadUrl
    if (chatReadUrl) {
      void fetch(chatReadUrl(projectId), { method: "POST" }).catch(
        () => undefined,
      )
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, unreadCount: 0 } : p)),
      )
    }
  }, [])

  // scopeKey в зависимостях обязателен: loadProjects объявлен с пустым списком
  // и берёт адреса из sourceRef, поэтому сам по себе он не пересоздаётся. Без
  // ключа смена выбранного пользователя в админке не перечитывала бы список.
  useEffect(() => {
    void loadProjects()
  }, [loadProjects, source.scopeKey])

  useEffect(() => {
    const id = searchParams.get("id")
    if (id) setSelectedId(id)
  }, [searchParams])

  useEffect(() => {
    if (!selectedId) {
      setRootFiles([])
      setPath([])
      setSelectedFile(null)
      setMessages([])
      setDriveAvailable(true)
      storageCursorRef.current = 0
      return
    }
    void loadDrive(selectedId, false)
  }, [selectedId, loadDrive])

  useEffect(() => {
    if (!selectedId || !driveAvailable) return
    const projectId = selectedId
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const since = storageCursorRef.current
          const res = await fetch(
            `/api/storage/v1/delta?projectId=${encodeURIComponent(projectId)}&since=${since}`,
          )
          if (!res.ok) return
          const data = await res.json()
          if (data.truncated) {
            await loadDrive(projectId, true)
            return
          }
          if (Array.isArray(data.changes) && data.changes.length > 0) {
            if (typeof data.cursor === "number") {
              storageCursorRef.current = data.cursor
            }
            await loadDrive(projectId, true)
          } else if (typeof data.cursor === "number") {
            storageCursorRef.current = data.cursor
          }
        } catch {
          // сетевые сбои поллинга игнорируем — следующий тик догонит
        }
      })()
    }, DELTA_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [selectedId, driveAvailable, loadDrive])

  useEffect(() => {
    if (selected) setDescDraft(selected.description ?? "")
  }, [selected])

  useEffect(() => {
    if (selectedId && bottomTab === "chat") void loadMessages(selectedId)
  }, [selectedId, bottomTab, loadMessages])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [])

  // ---------- проекты ----------

  const matchesQuery = useCallback(
    (p: Project) => {
      const q = query.trim().toLowerCase()
      return !q || p.name.toLowerCase().includes(q)
    },
    [query],
  )

  /**
   * Раздел проекта: архив перекрывает группу, неизвестная группа считается личной.
   * Разделы в боковом меню плоские, поэтому группировки внутри списка больше нет.
   */
  const tabOf = useCallback((p: Project): ProjectTab => {
    if (p.deletedAt) return "trash"
    if (p.sharedWithMe) return "shared"
    if (p.isArchived) return "archive"
    if (p.groupName === "tools") return "tools"
    return "projects"
  }, [])

  const counts = useMemo(() => {
    const acc: Record<ProjectTab, number> = {
      projects: 0,
      shared: 0,
      tools: 0,
      archive: 0,
      trash: 0,
    }
    for (const p of projects) acc[tabOf(p)] += 1
    return acc
  }, [projects, tabOf])

  const visibleProjects = useMemo(() => {
    // Источник без разделов (админский «Конвейер») показывает список целиком,
    // вместе с архивными: администратору нужно видеть все проекты пользователя
    // и понимать, какие из них не обрабатываются. Порядок задаёт запрос —
    // архивные идут последними.
    if (!source.splitByTab) return projects.filter(matchesQuery)
    return projects.filter((p) => tabOf(p) === projectTab && matchesQuery(p))
  }, [projects, projectTab, tabOf, matchesQuery, source.splitByTab])

  const selectProject = useCallback(
    (id: string) => {
      setSelectedId(id)
      setPath([])
      setSelectedFile(null)
      setDraft("")
      router.replace(buildUrl(id, projectTab), { scroll: false })
    },
    [router, buildUrl, projectTab],
  )

  const clearSelection = useCallback(() => {
    setSelectedId(null)
    router.replace(buildUrl(null, projectTab), { scroll: false })
  }, [router, buildUrl, projectTab])

  const patchProject = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      const res = await fetch(sourceRef.current.projectUrl(id), {
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
      notifyProjectsChanged()
    },
    [],
  )

  const createProject = useCallback(() => {
    if (creating) return
    setPrompt({
      title: t.newProject,
      label: t.projectNamePrompt,
      initial: tf(t.newProjectName, { number: projects.length + 1 }),
      confirmLabel: t.create,
      onSubmit: (name) => {
        void (async () => {
          setCreating(true)
          try {
            const res = await fetch(sourceRef.current.projectsUrl(), {
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
        })()
      },
    })
  }, [creating, lang, projects.length, t, loadProjects, selectProject])

  const renameProject = useCallback(
    (project: Project) => {
      setPrompt({
        title: t.rename,
        label: t.projectNamePrompt,
        initial: project.name,
        confirmLabel: t.saveChanges,
        onSubmit: (name) => {
          if (name === project.name) return
          void patchProject(project.id, { name })
        },
      })
    },
    [t, patchProject],
  )

  /** Архивирование — отдельный флаг, группу проекта не трогаем. */
  const setArchived = useCallback(
    (project: Project, archived: boolean) => {
      void patchProject(project.id, { isArchived: archived })
    },
    [patchProject],
  )

  const deleteProject = useCallback(
    (id: string) => {
      setConfirm({
        title: t.deleteProject,
        description: t.confirmDeleteProject,
        confirmLabel: t.mDelete,
        destructive: true,
        onConfirm: () => {
          void (async () => {
            const res = await fetch(sourceRef.current.projectUrl(id), {
              method: "DELETE",
            })
            if (!res.ok) {
              toast.error("Failed")
              return
            }
            clearSelection()
            await loadProjects()
          })()
        },
      })
    },
    [t, clearSelection, loadProjects],
  )

  const saveDescription = useCallback(() => {
    if (!selectedId) return
    void patchProject(selectedId, { description: descDraft }).then(() => {
      toast.success(t.saveDescription)
    })
  }, [selectedId, descDraft, patchProject, t.saveDescription])

  const openChat = useCallback(
    (projectId: string) => {
      selectProject(projectId)
      setBottomTab("chat")
      void loadMessages(projectId)
    },
    [selectProject, loadMessages],
  )

  const sendMessage = useCallback(() => {
    if (!selectedId || !draft.trim()) return
    const text = draft.trim()
    setDraft("")
    void (async () => {
      const res = await fetch(sourceRef.current.chatUrl(selectedId), {
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
    })()
  }, [selectedId, draft])

  // ---------- дерево файлов ----------

  const currentItems = useMemo(
    () => itemsAtPath(rootFiles, path),
    [rootFiles, path],
  )

  const currentTarget = useMemo<UploadTarget>(
    () => ({
      parentId: path.length ? path[path.length - 1].id : null,
      folderPath: pathToFolderPath(path),
    }),
    [path],
  )

  const inFolder = useMemo(() => findChildByName(rootFiles, "IN"), [rootFiles])
  const outFolder = useMemo(() => findChildByName(rootFiles, "OUT"), [rootFiles])

  const openFolder = useCallback((f: DriveFile) => {
    if (!f.isFolder) return
    setPath((p) => [...p, f])
    setSelectedFile(null)
  }, [])

  const goToCrumb = useCallback((index: number) => {
    setPath((p) => (index < 0 ? [] : p.slice(0, index + 1)))
    setSelectedFile(null)
  }, [])

  const goToPath = useCallback((nodes: DriveFile[]) => {
    setPath(nodes)
    setSelectedFile(null)
  }, [])

  const refreshDrive = useCallback(() => {
    if (selectedId) void loadDrive(selectedId, true)
  }, [selectedId, loadDrive])

  const createFolder = useCallback(
    (target: UploadTarget) => {
      if (!selectedId) return
      setPrompt({
        title: t.mNewFolder,
        label: t.folderNamePrompt,
        initial: "",
        confirmLabel: t.create,
        onSubmit: (name) => {
          void (async () => {
            const res = await fetch(sourceRef.current.folderUrl(selectedId), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, folderPath: target.folderPath }),
            })
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              toast.error(data.message ?? "Failed")
              return
            }
            await loadDrive(selectedId, true)
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const renameItem = useCallback(
    (file: DriveFile) => {
      if (!selectedId) return
      setPrompt({
        title: t.mRename,
        label: t.renamePrompt,
        initial: file.name,
        confirmLabel: t.saveChanges,
        onSubmit: (name) => {
          if (name === file.name) return
          void (async () => {
            const res = await fetch(
              sourceRef.current.fileUrl(selectedId, file.id),
              {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
              },
            )
            if (!res.ok) {
              const data = await res.json().catch(() => ({}))
              toast.error(data.message ?? "Failed")
              return
            }
            await loadDrive(selectedId, true)
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const deleteItems = useCallback(
    (files: DriveFile[]) => {
      if (!selectedId || files.length === 0) return
      const description =
        files.length === 1
          ? `${t.confirmDelete} — ${files[0].name}`
          : `${t.confirmDelete} — ${files.length}`
      setConfirm({
        title: t.mDelete,
        description,
        confirmLabel: t.mDelete,
        destructive: true,
        onConfirm: () => {
          void (async () => {
            let failed = 0
            for (const file of files) {
              const res = await fetch(
                sourceRef.current.fileUrl(selectedId, file.id),
                { method: "DELETE" },
              )
              if (!res.ok) failed += 1
            }
            if (failed > 0) toast.error("Failed")
            const removed = new Set(files.map((f) => f.id))
            setSelection((prev) => prev.filter((f) => !removed.has(f.id)))
            await loadDrive(selectedId, true)
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const deleteItem = useCallback(
    (file: DriveFile) => deleteItems([file]),
    [deleteItems],
  )

  const downloadItem = useCallback(
    (file: DriveFile) => {
      if (!selectedId || file.isFolder) return
      window.open(
        sourceRef.current.fileUrl(selectedId, file.id),
        "_blank",
        "noopener",
      )
    },
    [selectedId],
  )

  const uploadFiles = useCallback(
    async (list: FileList | File[], target: UploadTarget) => {
      if (!selectedId) return
      const files = Array.from(list)
      if (!files.length) return
      setUploading(true)
      try {
        for (const file of files) {
          try {
            await uploadViaXhr(sourceRef.current, selectedId, file, target)
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
    },
    [selectedId, loadDrive],
  )

  const triggerUpload = useCallback((target: UploadTarget) => {
    uploadTargetRef.current = target
    fileInputRef.current?.click()
  }, [])

  const triggerFolderUpload = useCallback((target: UploadTarget) => {
    uploadTargetRef.current = target
    folderInputRef.current?.click()
  }, [])

  const uploadFolderFiles = useCallback(
    async (list: FileList | File[], target: UploadTarget) => {
      if (!selectedId) return
      const files = Array.from(list).filter((f) => {
        const name = f.name.toLowerCase()
        return name !== ".ds_store" && name !== "thumbs.db"
      })
      if (!files.length) return
      setUploading(true)
      try {
        const dirs = new Set<string>()
        for (const file of files) {
          const rel = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath
          if (!rel) continue
          const parts = rel.split("/")
          parts.pop()
          if (parts.length) dirs.add(parts.join("/"))
        }
        for (const ensurePath of [...dirs].sort(
          (a, b) => a.split("/").length - b.split("/").length,
        )) {
          await fetch("/api/storage/v1/mkdir", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectId: selectedId,
              folderPath: target.folderPath,
              ensurePath,
            }),
          })
        }
        for (const file of files) {
          const rel = (file as File & { webkitRelativePath?: string })
            .webkitRelativePath
          let folderPath = target.folderPath
          if (rel) {
            const parts = rel.split("/")
            parts.pop()
            const nested = parts.join("/")
            const base = target.folderPath.replace(/^\/+|\/+$/g, "")
            folderPath = nested
              ? base
                ? `${base}/${nested}`
                : nested
              : base
          }
          try {
            await uploadViaXhr(sourceRef.current, selectedId, file, {
              parentId: null,
              folderPath,
            })
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
    },
    [selectedId, loadDrive],
  )

  const createTextFile = useCallback(
    (target: UploadTarget) => {
      if (!selectedId) return
      setPrompt({
        title: t.mNewText,
        label: t.folderNamePrompt,
        initial: "untitled.txt",
        confirmLabel: t.create,
        onSubmit: (rawName) => {
          void (async () => {
            let name = rawName.trim() || "untitled.txt"
            if (!/\.(txt|md|json)$/i.test(name)) name = `${name}.txt`
            const blob = new Blob([""], { type: "text/plain" })
            const file = new File([blob], name, { type: "text/plain" })
            try {
              await uploadViaXhr(sourceRef.current, selectedId, file, target)
              await loadDrive(selectedId, true)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed")
            }
          })()
        },
      })
    },
    [selectedId, t, loadDrive],
  )

  const shareProject = useCallback((project: Project) => {
    setShareTarget(project)
  }, [])

  const closeShareDialog = useCallback(() => setShareTarget(null), [])

  const restoreProject = useCallback(
    (project: Project) => {
      void (async () => {
        const res = await fetch("/api/storage/v1/project-restore", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: project.id }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? "Restore failed")
          return
        }
        toast.success(t.mUnarchive)
        await loadProjects()
      })()
    },
    [loadProjects, t.mUnarchive],
  )

  // ---------- контекстное меню ----------

  const openMenu = useCallback(
    (
      kind: ContextMenuKind,
      event: React.MouseEvent,
      extra?: Partial<ContextMenuState>,
    ) => {
      event.preventDefault()
      event.stopPropagation()
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 248),
        y: Math.min(event.clientY, window.innerHeight - 330),
        kind,
        ...extra,
      })
    },
    [],
  )

  const closeMenu = useCallback(() => setMenu(null), [])

  // ---------- перемещение ----------

  const openMoveDialog = useCallback(
    (items: DriveFile[]) => setMoveTargets(items.length ? items : null),
    [],
  )
  const closeMoveDialog = useCallback(() => setMoveTargets(null), [])

  /**
   * Перенос идёт через storage v1: `/rename` меняет логический путь,
   * объект в R2 остаётся на месте (см. docs/BACKEND_PLAN.md, модель B).
   */
  const moveItems = useCallback(
    async (items: DriveFile[], destFolderPath: string) => {
      if (!selectedId || items.length === 0) return
      let failed = 0
      for (const file of items) {
        const res = await fetch(sourceRef.current.moveUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: selectedId,
            fileId: file.id,
            folderPath: destFolderPath,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          failed += 1
          toast.error(data.message ?? `${file.name}: failed`)
        }
      }
      if (failed === 0) toast.success(t.mMove)
      setSelection([])
      setClipboard(null)
      await loadDrive(selectedId, true)
    },
    [selectedId, t.mMove, loadDrive],
  )

  // ---------- буфер обмена ----------

  const putToClipboard = useCallback(
    (op: ClipboardOp, items: DriveFile[]) => {
      if (!selectedId || items.length === 0) return
      setClipboard({ op, items, projectId: selectedId })
    },
    [selectedId],
  )

  const removeFromClipboard = useCallback((id: string) => {
    setClipboard((prev) => {
      if (!prev) return prev
      const items = prev.items.filter((f) => f.id !== id)
      // пустой буфер держать незачем — панель просто исчезает
      return items.length ? { ...prev, items } : null
    })
  }, [])

  const clearClipboard = useCallback(() => setClipboard(null), [])

  const pasteClipboard = useCallback(
    (destFolderPath: string) => {
      if (!clipboard || !selectedId) return
      if (clipboard.op === "cut") {
        void moveItems(clipboard.items, destFolderPath)
        return
      }
      void (async () => {
        const res = await fetch("/api/storage/v1/copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: clipboard.projectId,
            fileIds: clipboard.items.map((f) => f.id),
            destProjectId: selectedId,
            destFolderPath,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.message ?? "Copy failed")
          return
        }
        if (res.status === 202 && data.jobId) {
          toast.message(`Copy started (${data.jobId.slice(0, 8)}…)`)
          // Poll briefly then refresh.
          for (let i = 0; i < 30; i++) {
            await new Promise((r) => setTimeout(r, 1000))
            const jobRes = await fetch(`/api/storage/v1/jobs/${data.jobId}`)
            if (!jobRes.ok) break
            const jobData = await jobRes.json()
            const state = jobData.job?.state
            if (state === "done") {
              toast.success(t.clipboardPaste)
              break
            }
            if (state === "failed") {
              toast.error(jobData.job?.error ?? "Copy failed")
              break
            }
          }
        } else {
          toast.success(t.clipboardPaste)
        }
        setClipboard(null)
        await loadDrive(selectedId, true)
      })()
    },
    [clipboard, selectedId, moveItems, loadDrive, t.clipboardPaste],
  )

  const isCut = useCallback(
    (id: string) =>
      clipboard?.op === "cut" && clipboard.items.some((f) => f.id === id),
    [clipboard],
  )

  const value: WorkspaceValue = {
    t,
    lang,
    source,
    projects,
    visibleProjects,
    counts,
    projectTab,
    setProjectTab,
    loadingProjects,
    query,
    setQuery,
    selectedId,
    selected,
    selectProject,
    clearSelection,
    creating,
    createProject,
    renameProject,
    patchProject,
    setArchived,
    deleteProject,
    rootFiles,
    driveAvailable,
    loadingFiles,
    refreshDrive,
    inFolder,
    outFolder,
    path,
    currentItems,
    currentTarget,
    openFolder,
    goToCrumb,
    goToPath,
    selection,
    selectedFile,
    isSelected,
    selectFile,
    selectRange,
    setSelectedFile,
    clearFileSelection,
    density,
    setDensity,
    view,
    setView,
    bottomTab,
    setBottomTab,
    uploading,
    createFolder,
    renameItem,
    deleteItem,
    deleteItems,
    downloadItem,
    uploadFiles,
    triggerUpload,
    createTextFile,
    triggerFolderUpload,
    shareProject,
    shareTarget,
    closeShareDialog,
    restoreProject,
    moveTargets,
    openMoveDialog,
    closeMoveDialog,
    moveItems,
    clipboard,
    putToClipboard,
    removeFromClipboard,
    clearClipboard,
    pasteClipboard,
    isCut,
    menu,
    openMenu,
    closeMenu,
    descDraft,
    setDescDraft,
    saveDescription,
    messages,
    draft,
    setDraft,
    sendMessage,
    openChat,
    prompt,
    setPrompt,
    confirm,
    setConfirm,
    notImplemented,
  }

  return (
    <Ctx.Provider value={value}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            void uploadFiles(e.target.files, uploadTargetRef.current)
          }
          e.target.value = ""
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(e) => {
          if (e.target.files) {
            void uploadFolderFiles(e.target.files, uploadTargetRef.current)
          }
          e.target.value = ""
        }}
      />
      {children}
    </Ctx.Provider>
  )
}
