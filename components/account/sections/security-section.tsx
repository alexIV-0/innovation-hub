"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Eye, EyeOff, KeyRound, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  changePasswordSchema,
  type ChangePasswordInput,
} from "@/lib/account-schemas"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"

export function SecuritySection() {
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)

  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  const onSubmit = async (values: ChangePasswordInput) => {
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        toast.error(data.message ?? "Could not update your password.")
        return
      }
      toast.success(data.message ?? "Password updated.")
      form.reset({ currentPassword: "", newPassword: "", confirmPassword: "" })
    } catch {
      toast.error("Unable to reach the server. Please try again.")
    }
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <div className="space-y-8">
      <AccountPageHeader
        eyebrow="Account"
        title="Security"
        description="Rotate your password and keep your account safe."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Change password</CardTitle>
          <CardDescription>
            Pick something strong — at least 8 characters. You will stay signed in on this device.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="currentPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current password</FormLabel>
                    <FormControl>
                      <PasswordInput
                        placeholder="Enter your current password"
                        autoComplete="current-password"
                        visible={showCurrent}
                        onToggleVisibility={() => setShowCurrent((v) => !v)}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="At least 8 characters"
                          autoComplete="new-password"
                          visible={showNext}
                          onToggleVisibility={() => setShowNext((v) => !v)}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm new password</FormLabel>
                      <FormControl>
                        <PasswordInput
                          placeholder="Repeat the new password"
                          autoComplete="new-password"
                          visible={showNext}
                          onToggleVisibility={() => setShowNext((v) => !v)}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
            <CardFooter className="justify-end border-t pt-6">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" />
                )}
                Update password
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}

type PasswordInputProps = React.ComponentProps<typeof Input> & {
  visible: boolean
  onToggleVisibility: () => void
}

function PasswordInput({
  visible,
  onToggleVisibility,
  className,
  ...props
}: PasswordInputProps) {
  return (
    <div className="relative">
      <Input
        type={visible ? "text" : "password"}
        className={`pr-10 ${className ?? ""}`}
        {...props}
      />
      <button
        type="button"
        onClick={onToggleVisibility}
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
