import { z } from "zod"

export const videoCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(10),
  thumbnail: z.string().url(),
  videoUrl: z.string().url(),
  duration: z.string().min(2),
  category: z.string().min(2),
  isPublished: z.boolean().default(true),
})

export const videoUpdateSchema = videoCreateSchema.partial()

export const ideaCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(10),
  category: z.string().min(2),
  isPublished: z.boolean().default(true),
})

export const ideaUpdateSchema = ideaCreateSchema.partial()

export const reorderSchema = z.object({
  id: z.string().min(1),
  direction: z.enum(["up", "down"]),
})

export const userUpdateSchema = z.object({
  role: z.enum(["USER", "ADMIN"]).optional(),
  isActive: z.boolean().optional(),
})
