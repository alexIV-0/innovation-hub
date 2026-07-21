import { z } from "zod"

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters.")
    .max(120, "Name is too long."),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters.")
    .max(4000, "Description is too long."),
})

export type CreateProjectInput = z.infer<typeof createProjectSchema>

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().min(10).max(4000).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, {
    message: "Provide at least one field to update.",
  })

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>
