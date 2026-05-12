import { z } from "zod"

/**
 * Admin payloads can carry either:
 *  - a fully-qualified URL ("https://cdn.example.com/x.jpg"), or
 *  - an app-relative media-proxy path ("/api/media/<prefix>/<key>"), which is
 *    what the listing endpoints emit when they normalise direct-bucket URLs.
 *
 * Without this allowance, editing legacy rows fails Zod validation on PATCH
 * because the dialog round-trips the relative path back to the API.
 */
const mediaUrlSchema = z
  .string()
  .min(1, "Media URL is required.")
  .refine(
    (value) => {
      const trimmed = value.trim()
      if (trimmed.startsWith("/api/media/")) return true
      try {
        const parsed = new URL(trimmed)
        return parsed.protocol === "http:" || parsed.protocol === "https:"
      } catch {
        return false
      }
    },
    "Must be an http(s) URL or an /api/media/... path.",
  )

export const videoCreateSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(10),
  thumbnail: mediaUrlSchema,
  videoUrl: mediaUrlSchema,
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
