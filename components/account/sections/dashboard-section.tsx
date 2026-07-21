"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { FolderKanban, ImageIcon, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import {
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/project-schemas"
import { AccountPageHeader } from "@/components/account/shell/account-page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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

export type DashboardProject = {
  id: string
  name: string
  description: string
  driveFolderId: string | null
  createdAt: string
  updatedAt: string
}

type Props = {
  fullName: string
  email: string
  projectCount: number
  mediaCount: number
  projects: DashboardProject[]
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

export function DashboardSection({
  fullName,
  email,
  projectCount,
  mediaCount,
  projects: initialProjects,
}: Props) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [open, setOpen] = useState(false)

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: { name: "", description: "" },
  })

  const onCreate = async (values: CreateProjectInput) => {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const data = (await response.json().catch(() => null)) as
        | (DashboardProject & { message?: string })
        | { message?: string }
        | null

      if (!response.ok || !data || !("id" in data)) {
        toast.error(
          data && "message" in data && data.message
            ? data.message
            : "Could not create project.",
        )
        return
      }

      setProjects((prev) => [
        {
          id: data.id,
          name: data.name,
          description: data.description,
          driveFolderId: data.driveFolderId,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        },
        ...prev,
      ])
      toast.success("Project created.")
      form.reset({ name: "", description: "" })
      setOpen(false)
      router.refresh()
    } catch {
      toast.error("Unable to reach the server.")
    }
  }

  const firstName = fullName.trim().split(/\s+/)[0] || email.split("@")[0]

  return (
    <div className="space-y-8">
      <AccountPageHeader
        eyebrow="Cabinet"
        title={`Welcome, ${firstName}`}
        description="Manage your content projects and upload source media for generation."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </DialogTrigger>
            <CreateProjectDialog form={form} onSubmit={onCreate} />
          </Dialog>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Projects"
          value={String(projectCount)}
          icon={<FolderKanban className="h-4 w-4" />}
        />
        <Stat
          label="Media files"
          value={String(mediaCount)}
          icon={<ImageIcon className="h-4 w-4" />}
        />
      </div>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Recent projects
            </h2>
            <p className="text-sm text-muted-foreground">
              Open a project to upload media.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link href="/account/projects">View all</Link>
          </Button>
        </div>

        {projects.length === 0 ? (
          <EmptyProjects onCreate={() => setOpen(true)} />
        ) : (
          <ul className="divide-y divide-border/60 border-y border-border/60">
            {projects.slice(0, 6).map((project) => (
              <li key={project.id}>
                <Link
                  href={`/account/projects/${project.id}`}
                  className="group flex flex-col gap-1 py-4 transition-colors hover:bg-white/[0.02] sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground group-hover:text-primary">
                      {project.name}
                    </p>
                    <p className="line-clamp-1 text-sm text-muted-foreground">
                      {project.description}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatDate(project.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string
  value: string
  icon: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/60 px-4 py-4">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
          {label}
        </span>
        {icon}
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
    </div>
  )
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
      <FolderKanban className="mx-auto h-8 w-8 text-muted-foreground/70" />
      <p className="mt-3 font-medium text-foreground">No projects yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Create a project with a short description to get started.
      </p>
      <Button className="mt-5" onClick={onCreate}>
        <Plus className="h-4 w-4" />
        Create first project
      </Button>
    </div>
  )
}

function CreateProjectDialog({
  form,
  onSubmit,
}: {
  form: ReturnType<typeof useForm<CreateProjectInput>>
  onSubmit: (values: CreateProjectInput) => Promise<void>
}) {
  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Give the project a name and a clear description of what you need.
        </DialogDescription>
      </DialogHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Spring campaign reels" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    rows={5}
                    placeholder="Audience, tone, formats, must-have assets, delivery cadence…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </Form>
    </DialogContent>
  )
}
