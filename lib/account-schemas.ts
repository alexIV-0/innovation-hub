import { z } from "zod"

/**
 * bcrypt silently truncates inputs longer than 72 bytes, so we reject anything
 * over the limit up front to avoid two passwords hashing to the same value.
 */
const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(72, "Password must be at most 72 characters.")

export const updateProfileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(120, "Full name must be at most 120 characters."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254),
})

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Enter your current password.")
      .max(72),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(8, "Confirm your new password.").max(72),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must differ from the current one.",
    path: ["newPassword"],
  })

export const deleteAccountSchema = z.object({
  currentPassword: z
    .string()
    .min(1, "Enter your current password to confirm.")
    .max(72),
})

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>
