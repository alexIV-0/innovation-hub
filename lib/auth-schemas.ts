import { z } from "zod"

/**
 * bcrypt silently truncates inputs longer than 72 bytes, which would otherwise
 * make a "very long" password equivalent to its first 72 bytes — surprising
 * behavior that we explicitly reject up front.
 */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.")

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address.").max(254),
  password: passwordSchema,
})

export const registerSchema = z
  .object({
    fullName: z.string().min(2, "Full name must be at least 2 characters.").max(120),
    email: z.string().email("Enter a valid email address.").max(254),
    password: passwordSchema,
    confirmPassword: z.string().min(8, "Confirm your password.").max(72),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
