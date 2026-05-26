export type UserRole = "USER" | "ADMIN"

export type UserRecord = {
  id: string
  fullName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: Date
}

export type UserRecordWithPassword = UserRecord & {
  passwordHash: string
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
