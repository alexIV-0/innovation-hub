import { z } from "zod"

export const tagSuggestionScopeSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9._-]+$/i, "Invalid scope.")

export const tagSuggestionValueSchema = z
  .string()
  .trim()
  .min(1, "Enter a value.")
  .max(80)

export const tagSuggestionUpsertSchema = z.object({
  scope: tagSuggestionScopeSchema,
  value: tagSuggestionValueSchema,
})

export const tagSuggestionDeleteSchema = z.object({
  scope: tagSuggestionScopeSchema,
  value: tagSuggestionValueSchema,
})
