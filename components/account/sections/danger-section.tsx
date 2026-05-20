"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  deleteAccountSchema,
  type DeleteAccountInput,
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
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"

export function DangerSection({ email }: { email: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const form = useForm<DeleteAccountInput>({
    resolver: zodResolver(deleteAccountSchema),
    defaultValues: { currentPassword: "" },
  })

  const onSubmit = async (values: DeleteAccountInput) => {
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        toast.error(data.message ?? "Could not delete your account.")
        return
      }
      toast.success(data.message ?? "Account deleted.")
      setOpen(false)
      router.replace("/")
      router.refresh()
    } catch {
      toast.error("Unable to reach the server. Please try again.")
    }
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <div className="space-y-8">
      <AccountPageHeader
        eyebrow="Account"
        title="Danger zone"
        description="Permanent actions that cannot be undone."
      />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-xl text-destructive">Delete account</CardTitle>
          <CardDescription>
            Permanently remove the account associated with{" "}
            <span className="font-medium text-foreground">{email}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            <li>You will be signed out immediately.</li>
            <li>Your profile, email and password will be erased.</li>
            <li>If you are the last active admin you will need to promote another admin first.</li>
          </ul>
        </CardContent>
        <CardFooter className="justify-end border-t pt-6">
          <AlertDialog
            open={open}
            onOpenChange={(next) => {
              if (isSubmitting) return
              setOpen(next)
              if (!next) form.reset({ currentPassword: "" })
            }}
          >
            <Button
              type="button"
              variant="destructive"
              onClick={() => setOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete my account
            </Button>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  Confirm your password to delete the account for{" "}
                  <span className="font-medium text-foreground">{email}</span>. This action is
                  permanent.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onSubmit)}
                  className="space-y-4"
                  id="delete-account-form"
                >
                  <FormField
                    control={form.control}
                    name="currentPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            placeholder="Your current password"
                            autoComplete="current-password"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </form>
              </Form>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isSubmitting}>Cancel</AlertDialogCancel>
                {/* Plain submit instead of AlertDialogAction so the dialog
                    stays open if validation or the server rejects. */}
                <Button
                  type="submit"
                  form="delete-account-form"
                  variant="destructive"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-2 h-4 w-4" />
                  )}
                  Delete account
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      </Card>
    </div>
  )
}
