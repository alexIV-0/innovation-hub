import { z } from "zod"

export const featureSuggestionAttachmentSchema = z.object({
  key: z.string().min(1).max(512),
  url: z
    .string()
    .max(2048)
    .refine(
      (v) => v.startsWith("/api/media/") || /^https?:\/\//i.test(v),
      "Invalid attachment URL.",
    ),
  name: z.string().min(1).max(200),
  contentType: z.string().min(1).max(128),
  size: z.number().int().positive().max(250 * 1024 * 1024),
})

export function getFeatureSuggestionMaxFiles(): number {
  const raw = process.env.FEATURE_SUGGESTION_MAX_FILES
  if (!raw) return 5
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 5
}

export const featureSuggestionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "Name must be at most 80 characters."),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254),
  projectName: z
    .string()
    .trim()
    .min(1, "Enter a project name.")
    .max(100, "Project name must be at most 100 characters."),
  referenceUrl: z
    .string()
    .trim()
    .min(1, "Enter a reference URL.")
    .url("Enter a valid URL.")
    .max(2048),
  monthlyVolume: z
    .string()
    .trim()
    .min(1, "Estimate how many videos per month.")
    .max(50, "Keep this under 50 characters."),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be at most 2000 characters.")
    .optional()
    .default(""),
  automation: z
    .string()
    .trim()
    .min(1, "Describe the automation you want.")
    .min(10, "Describe the automation in at least 10 characters.")
    .max(4000, "Description must be at most 4000 characters."),
  attachments: z
    .array(featureSuggestionAttachmentSchema)
    .max(getFeatureSuggestionMaxFiles())
    .default([]),
  /** Honeypot — must stay empty (bots often fill this). */
  website: z.string().max(200).optional().default(""),
})

export type FeatureSuggestionAttachment = z.infer<
  typeof featureSuggestionAttachmentSchema
>
export type FeatureSuggestionInput = z.infer<typeof featureSuggestionSchema>

export function buildFeatureSuggestionNotes(input: {
  name: string
  email: string
  projectName: string
  referenceUrl: string
  monthlyVolume: string
  description?: string
  automation: string
  attachments: FeatureSuggestionAttachment[]
}): string {
  const lines = [
    `Submitted by: ${input.name} <${input.email}>`,
    "",
    `Project / folder name: ${input.projectName}`,
    `Reference: ${input.referenceUrl}`,
    `Estimated monthly videos: ${input.monthlyVolume}`,
  ]

  if (input.description?.trim()) {
    lines.push("", "Additional description:", input.description.trim())
  }

  lines.push("", "Automation request:", input.automation)

  if (input.attachments.length > 0) {
    lines.push("", "Attachments:")
    for (const file of input.attachments) {
      lines.push(`- ${file.name}: ${file.url}`)
    }
  }

  return lines.join("\n")
}
