export type UserRole = "USER" | "ADMIN"

export type AuthProvider = "local" | "google"

export type UserRecord = {
  id: string
  fullName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: Date
  balanceCents: number
}

export type ProjectGroupName = "personal" | "shared" | "tools" | "archive"

export type ProjectRecord = {
  id: string
  ownerId: string
  name: string
  description: string
  groupName: ProjectGroupName
  isPaused: boolean
  createdAt: Date
  updatedAt: Date
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
