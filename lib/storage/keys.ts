import { buildProjectObjectKey, projectObjectPrefix } from "@/lib/s3-config"

const PROJECT_KEY_RE =
  /^projects\/([^/]+)\/([^/]+)\/(?:options\/(.+)|([^/]+)\/(.+)|([^/]+))$/

export function projectPrefix(userId: string, projectId: string): string {
  return projectObjectPrefix(userId, projectId)
}

export function parseProjectIdFromKey(key: string): string | null {
  const segments = key.split("/")
  return segments.length >= 4 && segments[0] === "projects"
    ? (segments[2] ?? null)
    : null
}

export function logicalKeyForFile(input: {
  userId: string
  projectId: string
  folderPath: string
  name: string
}): string {
  const folder = input.folderPath.replace(/^\/+|\/+$/g, "")
  const relative = folder
    ? `${folder}/${input.name}`
    : input.name
  return buildProjectObjectKey(input.userId, input.projectId, relative)
}

export function folderPathFromKey(
  userId: string,
  projectId: string,
  key: string,
  fileName: string,
): string {
  const prefix = projectPrefix(userId, projectId)
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

export function isOptionsKey(
  key: string,
  userId: string,
  projectId: string,
): boolean {
  return key.startsWith(`${projectPrefix(userId, projectId)}options/`)
}

/** Physical object names are `{uuid}-{safeName}`. Strip the uuid for the catalog. */
const OBJECT_NAME_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i

export function logicalNameFromObjectKey(keyOrBasename: string): string {
  const basename = keyOrBasename.slice(keyOrBasename.lastIndexOf("/") + 1)
  const match = basename.match(OBJECT_NAME_UUID_RE)
  return match?.[1] && match[1].length > 0 ? match[1] : basename
}

export { PROJECT_KEY_RE }
