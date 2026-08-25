import { z } from "zod"

/** Что подключено к экземпляру инструмента: проект и папка задачи внутри него. */
export const toolSourceSchema = z.object({
  projectId: z.string().min(1).nullable().optional(),
  /** Логический путь папки задачи от корня проекта, например `OUT/Moneyball`. */
  folderPath: z.string().max(1024).nullable().optional(),
  /** Человекочитаемая подпись для карточки: «Sharing Test / OUT / Moneyball». */
  label: z.string().max(512).nullable().optional(),
})

export const createToolSchema = z.object({
  toolKey: z.string().min(1).max(64),
})

export const updateToolSchema = z
  .object({
    title: z.string().max(120),
    settings: z.record(z.unknown()),
    source: toolSourceSchema,
    sortOrder: z.number().int().min(0).max(10_000),
    /** Отметить открытие — чтобы список сортировался по свежести. */
    touch: z.literal(true),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.")

export type ToolSourceInput = z.infer<typeof toolSourceSchema>
export type UpdateToolInput = z.infer<typeof updateToolSchema>
