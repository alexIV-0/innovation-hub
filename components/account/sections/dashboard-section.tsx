"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  ArrowRight,
  ArrowUpRight,
  Clock,
  FolderKanban,
  ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"
import {
  createProjectSchema,
  type CreateProjectInput,
} from "@/lib/project-schemas"
import { Badge } from "@/components/ui/badge"
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
import { cn } from "@/lib/utils"

export type DashboardProject = {
  id: string
  name: string
  description: string
  driveFolderId: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type Props = {
  fullName: string
  email: string
  memberSince?: string
  projectCount: number
  mediaCount: number
  projects: DashboardProject[]
}

function formatDate(iso: string) {
  try {
    // Fixed locale: SSR and the browser must produce identical text,
    // otherwise React reports a hydration mismatch.
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  } catch {
    return iso
  }
}

function formatRelative(iso: string) {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return "—"
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

function useGreeting() {
  const [greeting, setGreeting] = useState("Welcome back")
  useEffect(() => {
    const hour = new Date().getHours()
    if (hour < 5) setGreeting("Working late")
    else if (hour < 12) setGreeting("Good morning")
    else if (hour < 18) setGreeting("Good afternoon")
    else setGreeting("Good evening")
  }, [])
  return greeting
}

export function DashboardSection({
  fullName,
  email,
  memberSince,
  projectCount,
  mediaCount,
  projects: initialProjects,
}: Props) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [open, setOpen] = useState(false)
  const greeting = useGreeting()

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
          isActive: data.isActive ?? true,
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
  const lastActivity =
    projects.length > 0
      ? projects.reduce(
          (latest, p) => (p.updatedAt > latest ? p.updatedAt : latest),
          projects[0].updatedAt,
        )
      : null

  return (
    <div className="space-y-10">
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="premium-card spotlight-band noise-overlay relative overflow-hidden px-6 py-8 md:px-10 md:py-10">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/80">
              <Sparkles className="h-3.5 w-3.5" />
              Your workspace
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-[2.6rem] md:leading-[1.1]">
              {greeting}, {firstName}
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
              Manage your content projects and upload source media for
              generation.
            </p>
            {memberSince ? (
              <p className="pt-1 text-xs text-muted-foreground/70">
                Member since {formatDate(memberSince)}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button variant="outline" asChild>
              <Link href="/account/projects">
                All projects
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button className="shadow-glow-soft">
                  <Plus className="h-4 w-4" />
                  New project
                </Button>
              </DialogTrigger>
              <CreateProjectDialog form={form} onSubmit={onCreate} />
            </Dialog>
          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Projects"
          value={String(projectCount)}
          hint="Active briefs in your workspace"
          icon={<FolderKanban className="h-[18px] w-[18px]" />}
          href="/account/projects"
        />
        <StatCard
          label="Media files"
          value={String(mediaCount)}
          hint="Source assets uploaded"
          icon={<ImageIcon className="h-[18px] w-[18px]" />}
        />
        <StatCard
          label="Last activity"
          value={lastActivity ? formatRelative(lastActivity) : "—"}
          hint={
            lastActivity
              ? "Most recent project update"
              : "No activity recorded yet"
          }
          icon={<Clock className="h-[18px] w-[18px]" />}
          className="sm:col-span-2 lg:col-span-1"
        />
      </section>

      {/* ── Recent projects ──────────────────────────────────── */}
      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Recent projects
            </h2>
            <p className="text-sm text-muted-foreground">
              Open a project to upload media and manage the brief.
            </p>
          </div>
          {projects.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
              asChild
            >
              <Link href="/account/projects">
                View all
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : null}
        </div>

        {projects.length === 0 ? (
          <EmptyProjects onCreate={() => setOpen(true)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {projects.slice(0, 8).map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        )}
      </section>

      {/* ── Quick links ──────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2">
        <QuickLink
          href="/account/projects"
          title="Manage projects"
          description="Review briefs, upload assets, keep everything organised."
          icon={<FolderKanban className="h-4 w-4" />}
        />
        <QuickLink
          href="/account"
          title="Profile & security"
          description="Update your name, email and password."
          icon={<UserRound className="h-4 w-4" />}
        />
      </section>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon,
  href,
  className,
}: {
  label: string
  value: string
  hint: string
  icon: React.ReactNode
  href?: string
  className?: string
}) {
  const classes = cn(
    "group relative block overflow-hidden rounded-2xl border border-border/60 bg-[hsl(var(--surface-2))]/60 px-5 py-5 transition-all duration-200",
    href &&
      "hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-glow-soft",
    className,
  )

  const body = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-white/[0.03] text-muted-foreground transition-colors duration-200 group-hover:border-primary/30 group-hover:text-primary">
          {icon}
        </span>
      </div>
      {/* suppressHydrationWarning: relative values ("5m ago") may drift
          between the server render and client hydration. */}
      <p
        suppressHydrationWarning
        className="mt-3 font-display text-[1.75rem] font-semibold leading-none tracking-tight text-foreground"
      >
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground/80">{hint}</p>
    </>
  )

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    )
  }
  return <div className={classes}>{body}</div>
}

function ProjectCard({ project }: { project: DashboardProject }) {
  return (
    <Link
      href={`/account/projects/${project.id}`}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-[hsl(var(--surface-2))]/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-glow-soft",
        project.isActive
          ? "border-border/60 hover:border-primary/30"
          : "border-border/40 opacity-75 hover:border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-gradient-to-b from-white/[0.06] to-transparent text-muted-foreground transition-colors duration-200 group-hover:border-primary/30 group-hover:text-primary">
          <FolderKanban className="h-[18px] w-[18px]" />
        </span>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
      </div>
      <div className="min-w-0 space-y-1">
        <p className="truncate font-medium text-foreground">{project.name}</p>
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {project.description}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted-foreground/70">
        <span>{formatDate(project.createdAt)}</span>
        {!project.isActive ? (
          <Badge
            variant="outline"
            className="border-border/60 bg-white/[0.03] text-[10px] font-medium text-muted-foreground"
          >
            Paused
          </Badge>
        ) : null}
      </div>
    </Link>
  )
}

function QuickLink({
  href,
  title,
  description,
  icon,
}: {
  href: string
  title: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-4 rounded-2xl border border-border/50 bg-white/[0.02] px-5 py-4 transition-all duration-200 hover:border-border hover:bg-white/[0.04]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-white/[0.03] text-muted-foreground transition-colors duration-200 group-hover:text-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  )
}

function EmptyProjects({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="spotlight-band relative overflow-hidden rounded-2xl border border-dashed border-border/70 px-6 py-14 text-center">
      <div className="relative z-10">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/20 to-primary/5 shadow-glow-soft">
          <FolderKanban className="h-6 w-6 text-primary" />
        </span>
        <p className="mt-4 font-display text-lg font-semibold text-foreground">
          No projects yet
        </p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Create a project with a short description of the goal — audience,
          tone, formats — and start uploading media.
        </p>
        <Button className="mt-6 shadow-glow-soft" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Create first project
        </Button>
      </div>
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
