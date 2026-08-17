export type UserRole = "USER" | "ADMIN"

export type AuthProvider = "local" | "google"

export type UserRecord = {
  id: string
  fullName: string
  email: string
  role: UserRole
  /** Аккаунт не заблокирован — к автоматизации отношения не имеет. */
  isActive: boolean
  createdAt: Date
  balanceCents: number
  driveFolderId: string | null
  mustChangePassword: boolean
  /**
   * Админский гейт конвейера (/admin/pipeline, колонка 1). Выключенный
   * пользователь снимается со слежения целиком, флаги его проектов при этом
   * не меняются. Расшаренные проекты гейтятся флагом владельца.
   */
  automationEnabled: boolean
}

export type ProjectGroupName = "personal" | "shared" | "tools" | "archive"

export type ProjectRecord = {
  id: string
  /** Alias of userId — used by the S3 workspace UI. */
  ownerId: string
  /** Alias of ownerId — used by Drive / YouGile integrations. */
  userId: string
  name: string
  description: string
  groupName: ProjectGroupName
  isPaused: boolean
  driveFolderId: string | null
  isActive: boolean
  /** Проект в архиве: скрыт из рабочего списка, обработки по нему не запускаются. */
  isArchived: boolean
  archivedAt: Date | null
  /** Soft-deleted into project trash; purged after retention. */
  deletedAt: Date | null
  /** Optional client grouping (UI hierarchy; not part of R2 keys). */
  clientId: string | null
  createdAt: Date
  updatedAt: Date
  /** YouGile group chat id, created lazily on the first chat message. */
  yougileChatId: string | null
}

export type ClientRecord = {
  id: string
  userId: string
  displayName: string
  createdAt: Date
}

export type ProjectFileRecord = {
  id: string
  projectId: string
  folderPath: string
  name: string
  isFolder: boolean
  s3Key: string | null
  sizeBytes: number
  contentType: string
  createdAt: Date
}

export type MessageSenderRole = "user" | "team"

export type ProjectMessageRecord = {
  id: string
  projectId: string
  senderId: string | null
  senderRole: MessageSenderRole
  text: string
  createdAt: Date
  readByUser: boolean
  readByTeam: boolean
}

export type ProjectChatSenderType = "client" | "team" | "system"

export type ProjectChatMessageRecord = {
  id: string
  projectId: string
  senderType: ProjectChatSenderType
  senderUserId: string | null
  senderName: string
  body: string
  yougileMessageId: string | null
  delivered: boolean
  createdAt: Date
}

export type ProjectMediaRecord = {
  id: string
  projectId: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
  driveFileId: string
  createdAt: Date
}

export type UserRecordWithPassword = UserRecord & {
  /** Null for OAuth-only accounts (e.g. Google sign-in without a password). */
  passwordHash: string | null
  authProvider: AuthProvider
  providerAccountId: string | null
}

export type VideoRecord = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  /** @deprecated Use tags[0]; kept for transitional reads */
  category: string
  isPublished: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type IdeaRecord = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  tags: string[]
  /** @deprecated Use tags[0]; kept for transitional reads */
  category: string
  isPublished: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export type TagSuggestionRecord = {
  fieldScope: string
  value: string
  usageCount: number
  createdAt: Date
  updatedAt: Date
}

export type RemoteComputerStatus = "idle" | "busy" | "error"

export type RemoteComputerRecord = {
  id: string
  name: string
  description: string
  status: RemoteComputerStatus
  currentProjectId: string | null
  currentTask: string | null
  /** UUID машины при самозаписи; у заведённых руками — null. */
  machineUuid: string | null
  lastHeartbeatAt: Date | null
  meta: Record<string, unknown>
  createdBy: string
  createdAt: Date
  revokedAt: Date | null
}

/** Heartbeat window: computer is online if last_heartbeat_at is within this many ms. */
export const REMOTE_COMPUTER_ONLINE_MS = 90_000
