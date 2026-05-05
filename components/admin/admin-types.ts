export type AdminVideo = {
  id: string
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  category: string
  isPublished: boolean
  sortOrder: number
}

export type AdminIdea = {
  id: string
  title: string
  description: string
  category: string
  isPublished: boolean
  sortOrder: number
}

export type AdminUser = {
  id: string
  fullName: string
  email: string
  role: "USER" | "ADMIN"
  isActive: boolean
  createdAt: string
}

export type VideoDraft = {
  title: string
  description: string
  thumbnail: string
  videoUrl: string
  duration: string
  category: string
}

export type IdeaDraft = {
  title: string
  description: string
  category: string
}

export const emptyVideoDraft: VideoDraft = {
  title: "",
  description: "",
  thumbnail: "",
  videoUrl: "",
  duration: "",
  category: "",
}

export const emptyIdeaDraft: IdeaDraft = {
  title: "",
  description: "",
  category: "",
}
