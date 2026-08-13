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
  /** Soft-deleted project (cabinet trash tab). */
  deletedAt: string | null
  /** Shared with the current user (not owned). */
  sharedWithMe: boolean
  memberRole?: "viewer" | "editor" | null
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

/** Что рабочей области разрешено делать с данными. */
export type WorkspaceCapabilities = {
  createProject: boolean
  deleteProject: boolean
  renameProject: boolean
  archiveProject: boolean
  upload: boolean
  createFolder: boolean
  renameItem: boolean
  deleteItem: boolean
  move: boolean
}

/**
 * Откуда рабочая область берёт данные и что ей позволено.
 *
 * Компоненты рабочей области одни и те же в кабинете и в админском
 * «Конвейере», различаются только адреса и права: кабинет видит проекты одного
 * пользователя без служебной папки options, админка — все проекты выбранного
 * пользователя целиком. Поэтому серверная часть вынесена в один объект, а не
 * растащена по компонентам: в провайдере ровно одно место, которое знает про
 * эндпоинты.
 */
export type WorkspaceSource = {
  /**
   * Что именно показывает источник. Меняется — список проектов перечитывается.
   *
   * Нужен потому, что загрузчики в провайдере объявлены с пустым списком
   * зависимостей и берут источник из ref: без явного ключа смена выбранного
   * пользователя в админке не перезапускала бы загрузку, и колонка проектов
   * оставалась пустой. В кабинете область одна и ключ постоянный.
   */
  scopeKey: string
  /**
   * Делить ли проекты по разделам из URL (?tab=projects|shared|tools|archive).
   *
   * В кабинете да — разделы это пункты бокового меню. В админке нет: такого
   * меню там не существует, поэтому список показывается целиком, вместе с
   * архивными, а архив помечается на карточке.
   */
  splitByTab: boolean
  /**
   * Адрес самой страницы рабочей области — для router.replace при выборе
   * проекта и для «открыть в новом окне». В кабинете это /account/projects,
   * в админке /admin/pipeline с выбранным пользователем в query.
   */
  pageUrl: (params: { id: string | null; tab: string }) => string
  /** Список проектов рабочей области. */
  projectsUrl: () => string
  /** Дерево файлов + состояние автоматизации одного проекта. */
  driveUrl: (projectId: string) => string
  /** Курсор журнала изменений: с него начинается опрос delta. */
  treeCursorUrl: (projectId: string) => string
  /** Один проект: PATCH — изменить, DELETE — удалить. */
  projectUrl: (projectId: string) => string
  /** Папки проекта: POST — создать вложенную. */
  folderUrl: (projectId: string) => string
  /** Элемент дерева: PATCH — переименовать, DELETE — удалить, GET — скачать. */
  fileUrl: (projectId: string, fileId: string) => string
  /** Загрузка файла: отдельным XHR, чтобы был прогресс. */
  uploadUrl: (projectId: string, params: URLSearchParams) => string
  /** Перемещение элемента между папками. */
  moveUrl: () => string
  /**
   * Развёрнутое описание проекта — options/description.md. Необязательный:
   * наличие адреса включает редактор в панели описания. В кабинете его нет,
   * потому что описание пишет администрация, а пользователь его читает.
   */
  descriptionMdUrl?: (projectId: string) => string
  chatUrl: (projectId: string) => string
  /**
   * Отметка «прочитано». Необязательная: в админке её нет, потому что в
   * project_chat_messages отметки со стороны команды не существует — есть только
   * chat_last_read_at владельца.
   */
  chatReadUrl?: (projectId: string) => string
  /**
   * Кто «я» в чате. В кабинете сообщения пользователя — 'client', в админке
   * это тот же чат с другой стороны, поэтому 'team': свои сообщения справа,
   * пользовательские слева.
   */
  chatPerspective: "client" | "team"
  /** Показывать служебную папку options (в кабинете она скрыта). */
  showServiceFolders: boolean
  can: WorkspaceCapabilities
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
