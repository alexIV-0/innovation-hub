export type UserRole = "USER" | "ADMIN"

export type AuthProvider = "local" | "google"

export type UserRecord = {
  id: string
  fullName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: Date
  driveFolderId: string | null
}

export type ProjectRecord = {
  id: string
  userId: string
  name: string
  description: string
  driveFolderId: string | null
  createdAt: Date
  updatedAt: Date
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
