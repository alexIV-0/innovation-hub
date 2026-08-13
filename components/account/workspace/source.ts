import type { WorkspaceSource } from "./types"

/**
 * Источник данных кабинета — поведение по умолчанию.
 *
 * Ровно те адреса, по которым рабочая область ходила до появления
 * WorkspaceSource, поэтому подключение источника ничего не меняет для
 * /account/projects. Админский источник живёт в
 * components/admin/pipeline/pipeline-source.ts.
 */
export const CABINET_SOURCE: WorkspaceSource = {
  // Область одна — проекты владельца сессии, поэтому ключ постоянный.
  scopeKey: "cabinet",
  splitByTab: true,
  pageUrl: ({ id, tab }) => {
    const params = new URLSearchParams()
    if (id) params.set("id", id)
    if (tab !== "projects") params.set("tab", tab)
    const qs = params.toString()
    return qs ? `/account/projects?${qs}` : "/account/projects"
  },
  projectsUrl: () => "/api/projects?archived=all",
  driveUrl: (projectId) => `/api/projects/${projectId}/drive`,
  treeCursorUrl: (projectId) =>
    `/api/storage/v1/tree?projectId=${encodeURIComponent(projectId)}`,
  projectUrl: (projectId) => `/api/projects/${projectId}`,
  folderUrl: (projectId) => `/api/projects/${projectId}/drive`,
  fileUrl: (projectId, fileId) =>
    `/api/projects/${projectId}/drive/files/${fileId}`,
  uploadUrl: (projectId, params) =>
    `/api/projects/${projectId}/media?${params.toString()}`,
  moveUrl: () => "/api/storage/v1/rename",
  chatUrl: (projectId) => `/api/projects/${projectId}/chat`,
  chatReadUrl: (projectId) => `/api/projects/${projectId}/chat/read`,
  chatPerspective: "client",
  showServiceFolders: false,
  can: {
    createProject: true,
    deleteProject: true,
    renameProject: true,
    archiveProject: true,
    upload: true,
    createFolder: true,
    renameItem: true,
    deleteItem: true,
    move: true,
  },
}
