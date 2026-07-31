import { z } from "zod"

export const projectGroupSchema = z.enum([
  "personal",
  "shared",
  "tools",
  "archive",
])

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a project name.")
    .max(120, "Name must be at most 120 characters."),
  description: z.string().trim().max(4000).optional().default(""),
  groupName: projectGroupSchema.optional().default("personal"),
})

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(4000).optional(),
    groupName: projectGroupSchema.optional(),
    isPaused: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.groupName !== undefined ||
      data.isPaused !== undefined ||
      data.isActive !== undefined,
    { message: "Nothing to update." },
  )

export const createFolderSchema = z.object({
  folderPath: z.string().max(500).default(""),
  name: z
    .string()
    .trim()
    .min(1, "Enter a folder name.")
    .max(180)
    .regex(/^[^/\\]+$/, "Folder name cannot contain slashes."),
})

export const renameFileSchema = z
  .object({
    id: z.string().uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(/^[^/\\]+$/, "Name cannot contain slashes.")
      .optional(),
    folderPath: z.string().max(500).optional(),
  })
  .refine((d) => d.name !== undefined || d.folderPath !== undefined, {
    message: "Provide a new name or folder path.",
  })

export const deleteFileSchema = z.object({
  id: z.string().uuid(),
})

export const presignUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  folderPath: z.string().max(500).default(""),
  sizeBytes: z.number().int().nonnegative().max(500 * 1024 * 1024).optional(),
})

export const confirmUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  folderPath: z.string().max(500).default(""),
  s3Key: z.string().trim().min(1).max(1024),
  sizeBytes: z.number().int().nonnegative().max(500 * 1024 * 1024),
})

export const createMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Message cannot be empty.")
    .max(4000, "Message is too long."),
})

export const statsQuerySchema = z.object({
  range: z.enum(["day", "week", "month"]).default("week"),
  projectId: z.string().uuid().optional().nullable(),
})

export const updateFolderStateSchema = z.object({
  enabled: z.boolean(),
})

export type UpdateFolderStateInput = z.infer<typeof updateFolderStateSchema>

const exposedOptionValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(10_000),
])

export const updateExposedOptionsSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z.array(z.string().min(1).max(200)).min(1).max(32),
        value: exposedOptionValueSchema,
      }),
    )
    .min(1)
    .max(100),
})

export type UpdateExposedOptionsInput = z.infer<
  typeof updateExposedOptionsSchema
>

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
