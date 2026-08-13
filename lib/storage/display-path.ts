import { findProjectById } from "@/lib/repositories/projects"
import { findUserById } from "@/lib/repositories/users"

export type DisplayContext = {
  ownerEmail: string
  projectName: string
}

export function buildDisplayPath(
  ctx: DisplayContext,
  folderPath: string,
  name: string,
): string {
  const parts = [ctx.ownerEmail, ctx.projectName]
  const folder = folderPath.replace(/^\/+|\/+$/g, "")
  if (folder) parts.push(...folder.split("/").filter(Boolean))
  if (name) parts.push(name)
  return parts.join(" / ")
}

export async function loadDisplayContext(
  projectId: string,
): Promise<DisplayContext | null> {
  const project = await findProjectById(projectId)
  if (!project) return null
  const owner = await findUserById(project.userId)
  return {
    ownerEmail: owner?.email || project.userId,
    projectName: project.name,
  }
}
