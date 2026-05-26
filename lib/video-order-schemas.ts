import { z } from "zod"

export const videoOrderSchema = z.object({
  videoId: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email.")
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254),
  projectName: z
    .string()
    .trim()
    .min(1, "Enter a project name.")
    .max(100),
  monthlyVolume: z
    .string()
    .trim()
    .min(1, "Estimate monthly video volume.")
    .max(50),
  description: z.string().trim().max(2000).optional().default(""),
  website: z.string().max(200).optional().default(""),
})

export type VideoOrderInput = z.infer<typeof videoOrderSchema>

export function buildVideoOrderNotes(input: {
  videoTitle: string
  videoUrl: string
  name: string
  email: string
  projectName: string
  monthlyVolume: string
  description?: string
}): string {
  const lines = [
    `Video order request`,
    "",
    `Reference video: ${input.videoTitle}`,
    `Link: ${input.videoUrl}`,
    "",
    `Submitted by: ${input.name} <${input.email}>`,
    `Project / folder name: ${input.projectName}`,
    `Estimated monthly videos: ${input.monthlyVolume}`,
  ]
  if (input.description?.trim()) {
    lines.push("", "Description:", input.description.trim())
  }
  return lines.join("\n")
}
