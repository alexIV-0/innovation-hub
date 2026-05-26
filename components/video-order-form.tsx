"use client"

import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Send } from "lucide-react"
import Link from "next/link"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { VideoCardItem } from "@/lib/content-types"
import { videoOrderSchema, type VideoOrderInput } from "@/lib/video-order-schemas"

type VideoOrderFormProps = {
  video: VideoCardItem
}

export function VideoOrderForm({ video }: VideoOrderFormProps) {
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [sessionName, setSessionName] = useState<string | null>(null)
  const [authChecked, setAuthChecked] = useState(false)

  const form = useForm<VideoOrderInput>({
    resolver: zodResolver(videoOrderSchema),
    mode: "onTouched",
    defaultValues: {
      videoId: video.id,
      name: "",
      email: "",
      projectName: "",
      monthlyVolume: "",
      description: "",
      website: "",
    },
  })

  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (data: {
          authenticated?: boolean
          email?: string
          fullName?: string | null
        } | null) => {
          if (data?.authenticated && data.email) {
            setSessionEmail(data.email)
            form.setValue("email", data.email)
          }
          if (data?.fullName) {
            setSessionName(data.fullName)
            form.setValue("name", data.fullName)
          }
        },
      )
      .catch(() => {})
      .finally(() => setAuthChecked(true))
  }, [form])

  const onSubmit = async (values: VideoOrderInput) => {
    try {
      const response = await fetch("/api/video-orders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null

      if (!response.ok) {
        if (response.status === 401) {
          toast.error("Sign in to submit a request.")
        } else {
          toast.error(data?.message ?? "Could not submit your request.")
        }
        return
      }

      toast.success(data?.message ?? "Request submitted.")
      form.reset({
        videoId: video.id,
        name: sessionName ?? "",
        email: sessionEmail ?? "",
        projectName: "",
        monthlyVolume: "",
        description: "",
        website: "",
      })
    } catch {
      toast.error("Network error. Please try again.")
    }
  }

  if (!authChecked) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <section className="mt-16 rounded-2xl border border-border/70 bg-surface-2/40 p-6 md:p-8">
      <h3 className="font-display text-xl font-bold text-foreground">
        Order a video like this
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">
        Reference: <span className="text-foreground">{video.title}</span>. We will
        create a task for our team in Asana.
      </p>

      {!sessionEmail ? (
        <p className="mt-4 text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">
            Sign in
          </Link>{" "}
          to submit a request.
        </p>
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="mt-6 space-y-5"
          >
            <input type="hidden" {...form.register("videoId")} />
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Your name</FormLabel>
                    <FormControl>
                      <Input {...field} required />
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
                      <Input type="email" {...field} required />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project name</FormLabel>
                    <FormControl>
                      <Input placeholder="Folder name for your project" {...field} required />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="monthlyVolume"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monthly video volume</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. 5–10" {...field} required />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Description{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Brief for what you need…"
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <input
              type="text"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="pointer-events-none absolute h-0 w-0 opacity-0"
              {...form.register("website")}
            />
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="rounded-full"
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Submit request
                </>
              )}
            </Button>
          </form>
        </Form>
      )}
    </section>
  )
}
