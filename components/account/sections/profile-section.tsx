"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Mail, User as UserIcon } from "lucide-react"
import { toast } from "sonner"
import {
  updateProfileSchema,
  type UpdateProfileInput,
} from "@/lib/account-schemas"
import type { UserRole } from "@/lib/domain-types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"

export type AccountUser = {
  id: string
  fullName: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
}

function avatarInitials(name: string, email: string) {
  const source = name.trim() || email.trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toLocaleUpperCase()
  }
  const match = source.match(/\p{L}/u)
  return (match?.[0] ?? source[0] ?? "?").toLocaleUpperCase()
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

export function ProfileSection({ user }: { user: AccountUser }) {
  const router = useRouter()
  const [current, setCurrent] = useState<AccountUser>(user)

  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      fullName: current.fullName,
      email: current.email,
    },
  })

  const onSubmit = async (values: UpdateProfileInput) => {
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => ({}))) as {
        message?: string
        profile?: { fullName: string; email: string }
      }
      if (!response.ok) {
        toast.error(data.message ?? "Could not update your profile.")
        return
      }
      const next = data.profile ?? values
      setCurrent((prev) => ({ ...prev, fullName: next.fullName, email: next.email }))
      form.reset({ fullName: next.fullName, email: next.email })
      toast.success(data.message ?? "Profile updated.")
      // Refresh so the header (which reads the session cookie) picks up the
      // new email/name on the next render.
      router.refresh()
    } catch {
      toast.error("Unable to reach the server. Please try again.")
    }
  }

  const isDirty = form.formState.isDirty
  const isSubmitting = form.formState.isSubmitting

  return (
    <div className="space-y-8">
      <AccountPageHeader
        eyebrow="Account"
        title="Profile"
        description="Personal information shown across Innovation Hub."
      />

      <Card className="border-border/60 bg-card/40">
        <CardContent className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <Avatar className="h-16 w-16 border border-border/60">
            <AvatarFallback className="bg-primary text-lg font-semibold text-primary-foreground">
              {avatarInitials(current.fullName, current.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="truncate font-display text-xl text-foreground">
              {current.fullName || "Unnamed account"}
            </p>
            <p className="truncate text-sm text-muted-foreground">{current.email}</p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant={current.role === "ADMIN" ? "default" : "secondary"}>
                {current.role === "ADMIN" ? "Admin" : "Member"}
              </Badge>
              <Badge variant={current.isActive ? "outline" : "destructive"}>
                {current.isActive ? "Active" : "Suspended"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                Joined {formatDate(current.createdAt)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Personal info</CardTitle>
          <CardDescription>
            Update the name and email associated with your account.
          </CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <UserIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Your name"
                          autoComplete="name"
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="email"
                          placeholder="you@example.com"
                          autoComplete="email"
                          className="pl-9"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Used for signing in and account notifications.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex items-center justify-between gap-3 border-t pt-6">
              <p className="text-xs text-muted-foreground">
                {isDirty ? "You have unsaved changes." : "Everything is up to date."}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!isDirty || isSubmitting}
                  onClick={() =>
                    form.reset({
                      fullName: current.fullName,
                      email: current.email,
                    })
                  }
                >
                  Reset
                </Button>
                <Button type="submit" disabled={!isDirty || isSubmitting}>
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Save changes
                </Button>
              </div>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
