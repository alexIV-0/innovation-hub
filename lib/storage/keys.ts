import { buildS3ObjectKey } from "@/lib/s3-config"

const PROJECT_KEY_RE =
  /^(?:[^/]+\/)?projects\/([^/]+)\/(?:options\/(.+)|([^/]+)\/(.+)|([^/]+))$/

export function projectPrefix(projectId: string): string {
  return buildS3ObjectKey(`projects/${projectId}/`)
}

export function parseProjectIdFromKey(key: string): string | null {
  const match = key.match(/\/projects\/([^/]+)\//)
  return match?.[1] ?? null
}

export function logicalKeyForFile(input: {
  projectId: string
  folderPath: string
  name: string
}): string {
  const folder = input.folderPath.replace(/^\/+|\/+$/g, "")
  const relative = folder
    ? `projects/${input.projectId}/${folder}/${input.name}`
    : `projects/${input.projectId}/${input.name}`
  return buildS3ObjectKey(relative)
}

export function folderPathFromKey(
  projectId: string,
  key: string,
  fileName: string,
): string {
  const prefix = projectPrefix(projectId)
  if (!key.startsWith(prefix)) return ""
  const rest = key.slice(prefix.length)
  if (!rest || rest === fileName) return ""
  const withoutName = rest.endsWith(`/${fileName}`)
    ? rest.slice(0, -(fileName.length + 1))
    : rest.includes("/")
      ? rest.split("/").slice(0, -1).join("/")
      : ""
  return withoutName
}

export function isOptionsKey(key: string, projectId: string): boolean {
  return key.includes(`/projects/${projectId}/options/`)
}

export { PROJECT_KEY_RE }
