const ASANA_API_BASE = "https://app.asana.com/api/1.0"

// Kill switch: Asana task creation is temporarily disabled. Flip back to
// `false` to re-enable video orders / feature suggestions posting to Asana.
const ASANA_TASK_CREATION_DISABLED = true

export class AsanaError extends Error {
  readonly status: number
  readonly asanaErrors?: unknown

  constructor(message: string, status: number, asanaErrors?: unknown) {
    super(message)
    this.name = "AsanaError"
    this.status = status
    this.asanaErrors = asanaErrors
  }
}

type AsanaConfig = {
  accessToken: string
  projectGid: string
  workspaceGid?: string
  defaultAssigneeGid?: string
  defaultSectionGid?: string
}

function getAsanaConfig(): AsanaConfig {
  const accessToken = process.env.ASANA_ACCESS_TOKEN?.trim()
  const projectGid = process.env.ASANA_PROJECT_GID?.trim()
  const workspaceGid = process.env.ASANA_WORKSPACE_GID?.trim()

  if (!accessToken) {
    throw new AsanaError("ASANA_ACCESS_TOKEN is not configured.", 500)
  }
  if (!projectGid) {
    throw new AsanaError("ASANA_PROJECT_GID is not configured.", 500)
  }

  return {
    accessToken,
    projectGid,
    workspaceGid: workspaceGid || undefined,
    defaultAssigneeGid: process.env.ASANA_DEFAULT_ASSIGNEE_GID?.trim() || undefined,
    defaultSectionGid: process.env.ASANA_DEFAULT_SECTION_GID?.trim() || undefined,
  }
}

async function asanaRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const { accessToken } = getAsanaConfig()
  const response = await fetch(`${ASANA_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  })

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; errors?: unknown }
    | null

  if (!response.ok) {
    const message =
      Array.isArray(payload?.errors) &&
      payload.errors[0] &&
      typeof payload.errors[0] === "object" &&
      payload.errors[0] !== null &&
      "message" in payload.errors[0] &&
      typeof (payload.errors[0] as { message?: string }).message === "string"
        ? (payload.errors[0] as { message: string }).message
        : `Asana API error (HTTP ${response.status}).`
    throw new AsanaError(message, response.status, payload?.errors)
  }

  if (!payload || !("data" in payload)) {
    throw new AsanaError("Unexpected Asana API response.", 502)
  }

  return payload.data as T
}

export type AsanaTask = {
  gid: string
  name: string
  permalink_url?: string
}

/** Moves a task into a project section (removes it from other sections in that project). */
export async function addTaskToSection(
  sectionGid: string,
  taskGid: string,
): Promise<void> {
  await asanaRequest(`/sections/${sectionGid}/addTask`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        task: taskGid,
      },
    }),
  })
}

export async function createAsanaTask(input: {
  name: string
  notes: string
  projectGid?: string
  sectionGid?: string
}): Promise<AsanaTask> {
  if (ASANA_TASK_CREATION_DISABLED) {
    throw new AsanaError("Asana task creation is temporarily disabled.", 500)
  }

  const config = getAsanaConfig()
  const projectGid = input.projectGid?.trim() || config.projectGid
  const sectionGid = input.sectionGid?.trim() || config.defaultSectionGid

  const body: Record<string, unknown> = {
    name: input.name,
    notes: input.notes,
    projects: [projectGid],
  }

  if (config.workspaceGid) {
    body.workspace = config.workspaceGid
  }
  if (config.defaultAssigneeGid) {
    body.assignee = config.defaultAssigneeGid
  }

  const task = await asanaRequest<AsanaTask>("/tasks", {
    method: "POST",
    body: JSON.stringify({ data: body }),
  })

  // memberships.section on create is unreliable; move explicitly after create.
  if (sectionGid) {
    await addTaskToSection(sectionGid, task.gid)
  }

  return task
}

export async function createFeatureSuggestionTask(input: {
  name: string
  notes: string
}): Promise<AsanaTask> {
  return createAsanaTask(input)
}

export async function attachExternalUrlToTask(
  taskGid: string,
  input: { url: string; name: string },
): Promise<void> {
  await asanaRequest("/attachments", {
    method: "POST",
    body: JSON.stringify({
      data: {
        resource_subtype: "external",
        parent: taskGid,
        url: input.url,
        name: input.name,
      },
    }),
  })
}
