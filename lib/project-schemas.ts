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

/**
 * `isActive` принимается только ради обратной совместимости со старыми
 * клиентами: колонки с таким именем больше нет, тумблер слежения один —
 * `isPaused`. Схема сводит одно к другому на входе, чтобы дальше по коду
 * гулял ровно один флаг. Если пришли оба, побеждает `isPaused`.
 */
export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(4000).optional(),
    groupName: projectGroupSchema.optional(),
    isPaused: z.boolean().optional(),
    isActive: z.boolean().optional(),
    isArchived: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.groupName !== undefined ||
      data.isPaused !== undefined ||
      data.isActive !== undefined ||
      data.isArchived !== undefined,
    { message: "Nothing to update." },
  )
  .transform(({ isActive, isPaused, ...rest }) => ({
    ...rest,
    isPaused: isPaused ?? (isActive === undefined ? undefined : !isActive),
  }))

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
  sizeBytes: z.number().int().nonnegative().optional(),
})

export const confirmUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  folderPath: z.string().max(500).default(""),
  s3Key: z.string().trim().min(1).max(1024),
  sizeBytes: z.number().int().nonnegative(),
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

/**
 * Значение свойства из options.json. Массивы обязательны: `valueRange` хранит
 * пару чисел, `autocomplete` — список строк даже в одиночном режиме.
 *
 * Здесь только форма значения. Содержательная проверка — границы, список
 * вариантов, режим контрола — в [lib/options/apply.ts](./options/apply.ts):
 * она смотрит в сам граф, потому что клиент эти настройки не присылает и
 * присылать не должен.
 */
const exposedOptionValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(10_000),
  z.array(z.string().max(1_000)).max(200),
  z.tuple([z.number().finite(), z.number().finite()]),
])

/** Одна правка: путь до `controlProps` и новое значение. */
export const exposedOptionChangeSchema = z.object({
  path: z.array(z.string().min(1).max(200)).min(1).max(32),
  value: exposedOptionValueSchema,
})

export const updateExposedOptionsSchema = z.object({
  changes: z.array(exposedOptionChangeSchema).min(1).max(100),
})

export type UpdateExposedOptionsInput = z.infer<
  typeof updateExposedOptionsSchema
>

export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
