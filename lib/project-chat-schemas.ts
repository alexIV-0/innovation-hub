import { z } from "zod"

export const sendProjectChatMessageSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Enter a message.")
    .max(4000, "Message must be at most 4000 characters."),
})

export type SendProjectChatMessageInput = z.infer<
  typeof sendProjectChatMessageSchema
>
