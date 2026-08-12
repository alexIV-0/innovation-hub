export type DriveFile = {
  id: string
  name: string
  mimeType: string
  isFolder: boolean
  sizeBytes: number | null
  modifiedAt: string | null
  createdAt: string | null
  children?: DriveFile[]
}

export type ProjectGroupName = "personal" | "shared" | "tools" | "archive"

export type Project = {
  id: string
  name: string
  description: string
  groupName: ProjectGroupName
  isPaused: boolean
  isActive?: boolean
  /** В архиве: скрыт из рабочего списка, обработки по нему не идут. */
  isArchived: boolean
  driveFolderId: string | null
  createdAt: string
  updatedAt: string
  unreadCount: number
}

export type ChatMessage = {
  id: string
  senderType: "client" | "team" | "system"
  body: string
  createdAt: string
}

/** Как отрисовываются файлы внутри области. */
export type ViewMode = "list" | "grid" | "columns"

/** Режим рабочей области: полный (3 колонки) или упрощённый (IN / OUT). */
export type Density = "full" | "simple"

export type BottomTab = "desc" | "settings" | "chat"

/** Куда загружать файлы / создавать папку. */
export type UploadTarget = {
  parentId: string | null
  /** Логический путь от корня проекта, например "IN/raw". */
  folderPath: string
}

/** Что делаем с содержимым буфера при вставке. */
export type ClipboardOp = "copy" | "cut"

export type Clipboard = {
  op: ClipboardOp
  items: DriveFile[]
  /** Откуда взяли — понадобится при вставке. */
  projectId: string
}

export type ContextMenuKind = "file" | "empty" | "project"

export type ContextMenuState = {
  x: number
  y: number
  kind: ContextMenuKind
  file?: DriveFile
  project?: Project
  target?: UploadTarget
}
