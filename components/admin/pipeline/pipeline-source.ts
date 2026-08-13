import type { WorkspaceSource } from "@/components/account/workspace/types"

/**
 * Источник данных админского «Конвейера».
 *
 * Отличия от кабинетного (components/account/workspace/source.ts):
 *
 *   — список проектов запрашивается по выбранному пользователю, а не по
 *     владельцу сессии, и включает архивные;
 *   — дерево приходит вместе со служебной папкой options;
 *   — чат смотрится со стороны команды;
 *   — из мутаций доступна только пауза: создавать, удалять, переименовывать и
 *     загружать файлы в чужой проект из «Конвейера» нельзя. Пауза — общий с
 *     пользователем тумблер, остальное его дело.
 *
 * Курсор дерева берётся из /api/storage/v1/tree без изменений: этот эндпоинт
 * принимает сессию, а requireProjectAccess пропускает роль ADMIN к любому
 * проекту (lib/storage/auth.ts).
 */
export function createPipelineSource(userId: string | null): WorkspaceSource {
  return {
    // Область — проекты выбранного пользователя. Сменился пользователь,
    // сменился ключ, список проектов перечитывается.
    scopeKey: `pipeline:${userId ?? "none"}`,
    // Разделов в админке нет: показываем все проекты пользователя сразу,
    // включая архивные — они помечены на карточке.
    splitByTab: false,
    pageUrl: ({ id, tab }) => {
      const params = new URLSearchParams()
      if (userId) params.set("user", userId)
      if (id) params.set("id", id)
      if (tab !== "projects") params.set("tab", tab)
      const qs = params.toString()
      return qs ? `/admin/pipeline?${qs}` : "/admin/pipeline"
    },
    projectsUrl: () =>
      userId
        ? `/api/admin/pipeline/projects?userId=${encodeURIComponent(userId)}`
        : "/api/admin/pipeline/projects",
    driveUrl: (projectId) => `/api/admin/pipeline/projects/${projectId}/drive`,
    treeCursorUrl: (projectId) =>
      `/api/storage/v1/tree?projectId=${encodeURIComponent(projectId)}`,
    projectUrl: (projectId) => `/api/admin/pipeline/projects/${projectId}`,
    // Чтение файла — для панели превью и просмотра служебных сайдкаров.
    // Роут отдаёт содержимое и ничего не пишет.
    fileUrl: (projectId, fileId) =>
      `/api/admin/pipeline/projects/${projectId}/files/${encodeURIComponent(fileId)}`,
    // Мутаций файлов в «Конвейере» нет (см. can ниже), но контракт источника
    // требует адреса. Ведут на роут проекта, который принимает только паузу:
    // случайный вызов вернёт 400, а не изменит чужой проект.
    folderUrl: (projectId) => `/api/admin/pipeline/projects/${projectId}`,
    uploadUrl: (projectId) => `/api/admin/pipeline/projects/${projectId}`,
    moveUrl: () => "/api/admin/pipeline/projects",
    descriptionMdUrl: (projectId) =>
      `/api/admin/pipeline/projects/${projectId}/description`,
    chatUrl: (projectId) => `/api/admin/pipeline/projects/${projectId}/chat`,
    chatPerspective: "team",
    showServiceFolders: true,
    can: {
      createProject: false,
      deleteProject: false,
      renameProject: false,
      archiveProject: false,
      upload: false,
      createFolder: false,
      renameItem: false,
      deleteItem: false,
      move: false,
    },
  }
}
