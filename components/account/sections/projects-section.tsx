"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/project-schemas"
import type { DashboardProject } from "@/components/account/sections/dashboard-section"
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

type Props = {
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

export function ProjectsSection({ projects: initial }: Props) {
  const router = useRouter()
  const [projects, setProjects] = useState(initial)
  const [open, setOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      router.push(`/account/projects/${data.id}`)
      router.refresh()
    } catch {
      toast.error("Unable to reach the server.")
    }
  }

  const onDelete = async (id: string) => {
    if (!window.confirm("Delete this project and all of its media?")) return
    setDeletingId(id)
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: "DELETE",
        credentials: "same-origin",
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          message?: string
        } | null
        toast.error(data?.message ?? "Could not delete project.")
        return
      }
      setProjects((prev) => prev.filter((p) => p.id !== id))
      toast.success("Project deleted.")
      router.refresh()
    } catch {
      toast.error("Unable to reach the server.")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8">
      <AccountPageHeader
        eyebrow="Projects"
        title="Your projects"
        description="Create projects, describe the brief, and upload media for content generation."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>New project</DialogTitle>
                <DialogDescription>
                  Give the project a name and a clear description of what you
                  need.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onCreate)}
                  className="space-y-4"
                >
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Brand kit Q3" {...field} />
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
                            placeholder="What should we produce, and from which assets?"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                    <Button
                      type="submit"
                      disabled={form.formState.isSubmitting}
                    >
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
          </Dialog>
        }
      />

      {projects.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-6 py-14 text-center">
          <p className="font-medium">No projects yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with a clear brief so we know the goal.
          </p>
          <Button className="mt-5" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Create project
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {projects.map((project) => (
            <li
              key={project.id}
              className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-[hsl(var(--surface-1))]/40 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <Link
                href={`/account/projects/${project.id}`}
                className="min-w-0 flex-1 space-y-1 hover:opacity-90"
              >
                <h2 className="font-display text-lg font-semibold tracking-tight">
                  {project.name}
                </h2>
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {project.description}
                </p>
                <p className="text-xs text-muted-foreground/80">
                  Created {formatDate(project.createdAt)}
                </p>
              </Link>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                disabled={deletingId === project.id}
                onClick={() => onDelete(project.id)}
                aria-label={`Delete ${project.name}`}
              >
                {deletingId === project.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
