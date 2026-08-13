export type LocaleText = { ru: string; en: string }

export type ActionPropDoc = {
  name: string
  type: string
  required: boolean
  notes: LocaleText
}

export type ActionGroup = "computer" | "storage"

export type ActionDoc = {
  action: string
  group: ActionGroup
  summary: LocaleText
  description: LocaleText
  props: ActionPropDoc[]
  exampleProps: Record<string, unknown>
  exampleResponse: unknown
}

export const MACHINE_API_PATH = "/api/v1"

export const MACHINE_API_ACTIONS: ActionDoc[] = [
  {
    action: "me",
    group: "computer",
    summary: {
      ru: "Идентичность и текущее состояние компьютера.",
      en: "Identity and current state of this computer.",
    },
    description: {
      ru: "Возвращает карточку компьютера: статус, online, текущий проект. props можно опустить или передать {}.",
      en: "Returns this computer’s card: status, online, current project. Omit props or send {}.",
    },
    props: [],
    exampleProps: {},
    exampleResponse: {
      id: "uuid",
      name: "render-box-1",
      description: "",
      status: "idle",
      online: true,
      currentProjectId: null,
      currentTask: null,
      lastHeartbeatAt: "2026-08-13T10:00:00.000Z",
      meta: {},
      createdAt: "2026-08-10T10:00:00.000Z",
    },
  },
  {
    action: "heartbeat",
    group: "computer",
    summary: {
      ru: "Присутствие и статус работы. Обновляет lastHeartbeatAt.",
      en: "Presence and work status. Updates lastHeartbeatAt.",
    },
    description: {
      ru: "Шлите каждые 20–30 секунд. Пустые props = только heartbeat. online = сигнал не старше 90 секунд.",
      en: "Send every 20–30 seconds. Empty props = heartbeat only. online = last signal within 90 seconds.",
    },
    props: [
      {
        name: "status",
        type: '"idle" | "busy" | "error"',
        required: false,
        notes: {
          ru: "Состояние агента.",
          en: "Agent state.",
        },
      },
      {
        name: "currentProjectId",
        type: "string | null",
        required: false,
        notes: {
          ru: "null сбрасывает проект; иначе проект должен существовать.",
          en: "null clears the project; otherwise the project must exist.",
        },
      },
      {
        name: "currentTask",
        type: "string | null",
        required: false,
        notes: {
          ru: "Короткая метка операции, до 500 символов.",
          en: "Short operation label, up to 500 characters.",
        },
      },
      {
        name: "meta",
        type: "object",
        required: false,
        notes: {
          ru: "Произвольный JSON; если передано — заменяет предыдущий meta целиком.",
          en: "Arbitrary JSON; when sent, replaces previous meta entirely.",
        },
      },
    ],
    exampleProps: {
      status: "busy",
      currentProjectId: "project-uuid",
      currentTask: "export-preview",
      meta: { progress: 0.4 },
    },
    exampleResponse: {
      id: "uuid",
      name: "render-box-1",
      status: "busy",
      online: true,
      currentProjectId: "project-uuid",
      currentTask: "export-preview",
      lastHeartbeatAt: "2026-08-13T10:00:30.000Z",
      meta: { progress: 0.4 },
    },
  },
  {
    action: "capabilities",
    group: "storage",
    summary: {
      ru: "Флаги возможностей API.",
      en: "API feature flags.",
    },
    description: {
      ru: "Чтобы клиент не хардкодил поддерживаемые операции.",
      en: "So the client does not hardcode supported operations.",
    },
    props: [],
    exampleProps: {},
    exampleResponse: {
      apiVersion: 1,
      protocol: 2,
      multipart: false,
      rename: true,
      move: true,
      copy: false,
      sharing: false,
      clients: true,
      originMtime: true,
      contentHash: true,
      trash: true,
    },
  },
  {
    action: "projects",
    group: "storage",
    summary: {
      ru: "Каталог клиентов и проектов.",
      en: "Clients and projects catalog.",
    },
    description: {
      ru: "Токен компьютера из админки видит все проекты (как ADMIN).",
      en: "An admin-issued computer token sees all projects (same as ADMIN).",
    },
    props: [],
    exampleProps: {},
    exampleResponse: {
      users: [
        {
          id: "uuid",
          email: "anya@studio.example",
          fullName: "Аня Смирнова",
        },
      ],
      clients: [{ id: "uuid", displayName: "Megafon" }],
      projects: [
        {
          id: "uuid",
          name: "Ads Q3",
          clientId: "uuid",
          userId: "uuid",
          ownerEmail: "anya@studio.example",
          groupName: "personal",
          isActive: true,
          isPaused: false,
          isArchived: false,
          archivedAt: null,
          updatedAt: "2026-08-13T12:00:00.000Z",
        },
      ],
    },
  },
  {
    action: "createProject",
    group: "storage",
    summary: {
      ru: "Создать проект в папке владельца токена.",
      en: "Create a project in the token owner's folder.",
    },
    description: {
      ru: "Токен, привязанный к одному проекту, создать новый не может (403).",
      en: "A token scoped to one project cannot create another (403).",
    },
    props: [
      {
        name: "name",
        type: "string",
        required: true,
        notes: { ru: "1–120 символов.", en: "1–120 characters." },
      },
      {
        name: "clientId",
        type: "string | null",
        required: false,
        notes: { ru: "Клиент владельца.", en: "Must belong to the owner." },
      },
    ],
    exampleProps: { name: "Ads Q3", clientId: null },
    exampleResponse: {
      project: {
        id: "uuid",
        name: "Ads Q3",
        userId: "uuid",
        ownerEmail: "anya@studio.example",
        isArchived: false,
        isPaused: false,
      },
    },
  },
  {
    action: "projectRename",
    group: "storage",
    summary: {
      ru: "Переименовать проект. Ключи в бакете не меняются.",
      en: "Rename a project. Object keys do not change.",
    },
    description: {
      ru: "Имя живёт в Postgres. Клиент перечитывает его следующим projects.",
      en: "The name lives in Postgres. Clients pick it up on the next projects call.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "name",
        type: "string",
        required: true,
        notes: { ru: "Новое имя, 1–120 символов.", en: "New name, 1–120 characters." },
      },
    ],
    exampleProps: { projectId: "project-uuid", name: "Kotliar" },
    exampleResponse: { project: { id: "project-uuid", name: "Kotliar" } },
  },
  {
    action: "projectState",
    group: "storage",
    summary: {
      ru: "Пауза или архивация проекта.",
      en: "Pause or archive a project.",
    },
    description: {
      ru: "paused и archived независимы. Архивный проект обработчик не трогает.",
      en: "paused and archived are independent. Workers must skip archived projects.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "paused",
        type: "boolean",
        required: false,
        notes: { ru: "Пауза обработки.", en: "Pause processing." },
      },
      {
        name: "archived",
        type: "boolean",
        required: false,
        notes: {
          ru: "В архив / из архива. Нужно хотя бы одно из paused/archived.",
          en: "Archive / unarchive. At least one of paused/archived is required.",
        },
      },
    ],
    exampleProps: { projectId: "project-uuid", archived: true },
    exampleResponse: {
      project: { id: "project-uuid", isArchived: true, isPaused: false },
    },
  },
  {
    action: "tree",
    group: "storage",
    summary: {
      ru: "Полное дерево файлов проекта из кэша.",
      en: "Full project file tree from cache.",
    },
    description: {
      ru: "Bootstrap / полная синхронизация. cursor — последний seq журнала; дальше используйте delta.",
      en: "Bootstrap / full sync. cursor is the latest journal seq; then use delta.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "prefix",
        type: "string",
        required: false,
        notes: {
          ru: "Логический путь папки. Пустая строка = весь проект.",
          en: "Logical folder path. Empty string = whole project.",
        },
      },
    ],
    exampleProps: { projectId: "project-uuid", prefix: "IN" },
    exampleResponse: {
      entries: [
        {
          id: "uuid",
          projectId: "project-uuid",
          folderPath: "IN",
          name: "clip.mov",
          isFolder: false,
          s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
          sizeBytes: 1234567,
          contentType: "video/quicktime",
        },
      ],
      cursor: 1842,
    },
  },
  {
    action: "delta",
    group: "storage",
    summary: {
      ru: "Инкрементальные изменения после cursor.",
      en: "Incremental changes after a cursor.",
    },
    description: {
      ru: "Если truncated: true — локальный индекс устарел, запросите tree заново. До 5000 событий за раз.",
      en: "If truncated is true, the local index is stale — call tree again. Up to 5000 events per call.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "since",
        type: "number",
        required: false,
        notes: {
          ru: "Cursor с прошлого ответа. По умолчанию 0.",
          en: "Cursor from the previous response. Default 0.",
        },
      },
    ],
    exampleProps: { projectId: "project-uuid", since: 1842 },
    exampleResponse: {
      changes: [
        {
          seq: 1843,
          op: "put",
          key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
          projectId: "project-uuid",
          name: "clip.mov",
          folderPath: "IN",
          isFolder: false,
          size: 1234567,
          etag: "abc123",
          contentHash: null,
          eventTime: 1722930000,
          fileId: "uuid",
          contentType: "video/quicktime",
        },
      ],
      cursor: 1843,
      truncated: false,
    },
  },
  {
    action: "presign",
    group: "storage",
    summary: {
      ru: "Короткоживущий signed URL. Байты идут напрямую в R2.",
      en: "Short-lived signed URL. Bytes go directly to R2.",
    },
    description: {
      ru: "PUT: загрузка. GET: скачивание. После успешного PUT вызовите notify.",
      en: "PUT: upload. GET: download. After a successful PUT, call notify.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "method",
        type: '"PUT" | "GET"',
        required: true,
        notes: { ru: "PUT — загрузка, GET — скачивание.", en: "PUT upload, GET download." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: {
          ru: "Для PUT при генерации нового ключа. По умолчанию \"\".",
          en: "For PUT when generating a new key. Default \"\".",
        },
      },
      {
        name: "fileName",
        type: "string",
        required: false,
        notes: {
          ru: "Нужен для PUT. Имя санитизируется на сервере.",
          en: "Required for PUT. Sanitized server-side.",
        },
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        notes: {
          ru: "Для PUT. Должен пройти политику загрузок.",
          en: "For PUT. Must pass the upload policy.",
        },
      },
      {
        name: "s3Key",
        type: "string",
        required: false,
        notes: {
          ru: "Обязателен для GET. Для PUT — переиспользовать существующий ключ.",
          en: "Required for GET. For PUT — reuse an existing key.",
        },
      },
      {
        name: "ttlSec",
        type: "number",
        required: false,
        notes: {
          ru: "60–86400, по умолчанию 3600.",
          en: "60–86400, default 3600.",
        },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      method: "PUT",
      folderPath: "IN",
      fileName: "clip.mov",
      contentType: "video/quicktime",
    },
    exampleResponse: {
      url: "https://…",
      method: "PUT",
      s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
      fileName: "clip.mov",
      folderPath: "IN",
      contentType: "video/quicktime",
      expiresIn: 3600,
    },
  },
  {
    action: "notify",
    group: "storage",
    summary: {
      ru: "Подтвердить объект после presigned PUT.",
      en: "Confirm an object after a presigned PUT.",
    },
    description: {
      ru: "Сервер делает HEAD в R2, пишет project_files и journal. Поля тела перекрывают metadata объекта.",
      en: "Server HEADs R2, upserts project_files and the journal. Body fields override object metadata.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "s3Key",
        type: "string",
        required: true,
        notes: { ru: "Ключ из ответа presign.", en: "Key from the presign response." },
      },
      {
        name: "fileName",
        type: "string",
        required: true,
        notes: { ru: "Имя файла.", en: "File name." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: { ru: "По умолчанию \"\".", en: "Default \"\"." },
      },
      {
        name: "sizeBytes",
        type: "number",
        required: false,
        notes: { ru: "Размер в байтах.", en: "Size in bytes." },
      },
      {
        name: "contentType",
        type: "string",
        required: false,
        notes: { ru: "MIME-тип.", en: "MIME type." },
      },
      {
        name: "originMtime",
        type: "number",
        required: false,
        notes: {
          ru: "Unix seconds — mtime на исходной машине.",
          en: "Unix seconds — mtime on the source machine.",
        },
      },
      {
        name: "contentHash",
        type: "string",
        required: false,
        notes: { ru: "Например sha256 hex.", en: "e.g. sha256 hex." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность / дедуп.", en: "Idempotency / dedup." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
      folderPath: "IN",
      fileName: "clip.mov",
      sizeBytes: 1234567,
      contentType: "video/quicktime",
    },
    exampleResponse: {
      file: {
        id: "uuid",
        projectId: "project-uuid",
        folderPath: "IN",
        name: "clip.mov",
        isFolder: false,
        s3Key: "projects/{userId}/{projectId}/IN/{uuid}-clip.mov",
        sizeBytes: 1234567,
        contentType: "video/quicktime",
      },
    },
  },
  {
    action: "mkdir",
    group: "storage",
    summary: {
      ru: "Создать папку в кэше (без объекта в R2).",
      en: "Create a folder row in the cache (no R2 object).",
    },
    description: {
      ru: "Имя options зарезервировано (403). Папки логические.",
      en: "The name options is reserved (403). Folders are logical.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "name",
        type: "string",
        required: true,
        notes: {
          ru: "1–180 символов, без / и \\.",
          en: "1–180 chars, no / or \\.",
        },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: { ru: "Родительский путь, по умолчанию \"\".", en: "Parent path, default \"\"." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность.", en: "Idempotency." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      name: "IN",
      folderPath: "",
    },
    exampleResponse: {
      file: {
        id: "uuid",
        projectId: "project-uuid",
        folderPath: "",
        name: "IN",
        isFolder: true,
        s3Key: null,
        sizeBytes: 0,
      },
    },
  },
  {
    action: "rename",
    group: "storage",
    summary: {
      ru: "Переименовать или переместить файл/папку (s3Key не меняется).",
      en: "Rename or move a file/folder (s3Key does not change).",
    },
    description: {
      ru: "Нужно хотя бы одно из name / folderPath. Коллизия имени → 409.",
      en: "Provide at least one of name / folderPath. Name collision → 409.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "fileId",
        type: "string",
        required: true,
        notes: { ru: "ID файла или папки.", en: "File or folder id." },
      },
      {
        name: "name",
        type: "string",
        required: false,
        notes: { ru: "Новое имя.", en: "New name." },
      },
      {
        name: "folderPath",
        type: "string",
        required: false,
        notes: { ru: "Новый родительский путь.", en: "New parent path." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность.", en: "Idempotency." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      fileId: "file-uuid",
      name: "clip-final.mov",
    },
    exampleResponse: {
      file: {
        id: "file-uuid",
        name: "clip-final.mov",
        folderPath: "IN",
      },
    },
  },
  {
    action: "deleteObject",
    group: "storage",
    summary: {
      ru: "Удалить файл или папку (каскадно).",
      en: "Delete a file or folder (cascade).",
    },
    description: {
      ru: "Удаляет объекты R2 для файлов и пишет journal. Папка options → 403.",
      en: "Removes R2 objects for files and journals deletes. options folder → 403.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "fileId",
        type: "string",
        required: true,
        notes: { ru: "ID файла или папки.", en: "File or folder id." },
      },
      {
        name: "eventId",
        type: "string",
        required: false,
        notes: { ru: "Идемпотентность.", en: "Idempotency." },
      },
    ],
    exampleProps: {
      projectId: "project-uuid",
      fileId: "file-uuid",
    },
    exampleResponse: {
      ok: true,
      deletedS3Keys: ["projects/{userId}/{projectId}/IN/{uuid}-clip.mov"],
    },
  },
  {
    action: "reindex",
    group: "storage",
    summary: {
      ru: "Полный LIST R2 vs кэш Postgres.",
      en: "Full LIST of R2 vs Postgres cache.",
    },
    description: {
      ru: "Вставляет / обновляет / удаляет строки кэша. До 120 секунд. Пропускает options/* и project-meta.json.",
      en: "Inserts / updates / removes cache rows. Up to 120 seconds. Skips options/* and project-meta.json.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
    ],
    exampleProps: { projectId: "project-uuid" },
    exampleResponse: {
      ok: true,
      scanned: 120,
      inserted: 3,
      updated: 1,
      removed: 0,
    },
  },
  {
    action: "getSidecar",
    group: "storage",
    summary: {
      ru: "Прочитать automation JSON из R2.",
      en: "Read automation JSON from R2.",
    },
    description: {
      ru: "folder-state или options. 404 если объекта нет.",
      en: "folder-state or options. 404 if the object is missing.",
    },
    props: [
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "name",
        type: '"folder-state" | "options"',
        required: true,
        notes: { ru: "Какой sidecar читать.", en: "Which sidecar to read." },
      },
    ],
    exampleProps: { projectId: "project-uuid", name: "folder-state" },
    exampleResponse: {
      key: "projects/{userId}/{projectId}/options/folderState.json",
      body: "{ … }",
    },
  },
  {
    action: "putSidecar",
    group: "storage",
    summary: {
      ru: "Обновить sidecar. Тип задаётся полем kind.",
      en: "Update a sidecar. Discriminated by kind.",
    },
    description: {
      ru: "kind: folder-state (вкл/выкл автоматизацию), options (patch exposedToSite), raw (заменить тело целиком).",
      en: "kind: folder-state (toggle automation), options (patch exposedToSite), raw (replace entire body).",
    },
    props: [
      {
        name: "kind",
        type: '"folder-state" | "options" | "raw"',
        required: true,
        notes: { ru: "Вариант обновления.", en: "Update variant." },
      },
      {
        name: "projectId",
        type: "string",
        required: true,
        notes: { ru: "ID проекта.", en: "Project id." },
      },
      {
        name: "enabled",
        type: "boolean",
        required: false,
        notes: {
          ru: "Для kind=folder-state.",
          en: "For kind=folder-state.",
        },
      },
      {
        name: "changes",
        type: "{ path: string[], value }[]",
        required: false,
        notes: { ru: "Для kind=options.", en: "For kind=options." },
      },
      {
        name: "sidecar",
        type: '"folder-state" | "options"',
        required: false,
        notes: { ru: "Для kind=raw.", en: "For kind=raw." },
      },
      {
        name: "body",
        type: "string",
        required: false,
        notes: { ru: "Для kind=raw — JSON-строка.", en: "For kind=raw — JSON string." },
      },
      {
        name: "ifMatch",
        type: "string",
        required: false,
        notes: { ru: "Для kind=raw — условная запись по ETag.", en: "For kind=raw — conditional write by ETag." },
      },
    ],
    exampleProps: {
      kind: "folder-state",
      projectId: "project-uuid",
      enabled: true,
    },
    exampleResponse: {
      folderState: { enabled: true },
    },
  },
]

export const MACHINE_API_ERRORS: {
  status: number
  meaning: LocaleText
}[] = [
  {
    status: 400,
    meaning: {
      ru: "Невалидный JSON, неизвестный action или неверные props.",
      en: "Invalid JSON, unknown action, or invalid props.",
    },
  },
  {
    status: 401,
    meaning: {
      ru: "Нет токена или токен неверный / отозван.",
      en: "Missing token, or token is invalid / revoked.",
    },
  },
  {
    status: 403,
    meaning: {
      ru: "Аккаунт создателя неактивен, либо операция запрещена (например reserved name).",
      en: "Creator account inactive, or the operation is forbidden (e.g. reserved name).",
    },
  },
  {
    status: 404,
    meaning: {
      ru: "Компьютер, проект или файл не найден.",
      en: "Computer, project, or file not found.",
    },
  },
  {
    status: 409,
    meaning: {
      ru: "Конфликт: дубликат имени, нет объекта в R2, ETag.",
      en: "Conflict: duplicate name, missing R2 object, ETag.",
    },
  },
  {
    status: 503,
    meaning: {
      ru: "Хранилище не настроено или сбой R2 / reindex.",
      en: "Storage not configured, or R2 / reindex failure.",
    },
  },
]
