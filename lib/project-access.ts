import { NextResponse } from "next/server"

import type { ProjectRecord } from "@/lib/domain-types"
import {
  isProjectMemberRole,
  permissionsFor,
  roleAtLeast,
  type ProjectAccessRole,
  type ProjectPermissions,
} from "@/lib/project-roles"
import { findProjectMembership } from "@/lib/repositories/project-members"
import { findProjectById } from "@/lib/repositories/projects"

/**
 * Проверка доступа к проекту на стороне сервера.
 *
 * Сами правила — в lib/project-roles.ts: тот модуль чистый, без обращений к базе
 * и к next/server, и поэтому его же берёт интерфейс
 * (components/account/workspace/access.ts). Матрица прав одна, а не по копии на
 * каждый слой — иначе кнопка и проверка рано или поздно разойдутся.
 */
export * from "@/lib/project-roles"

export type ProjectAccess = {
  project: ProjectRecord
  role: ProjectAccessRole
  permissions: ProjectPermissions
}

/**
 * Роль пользователя сайта в проекте: владелец, участник или никто.
 *
 * Машинные токены сюда не ходят — у них своя авторизация в lib/storage/auth.ts,
 * и расшаривание на них не распространяется.
 */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<ProjectAccess | null> {
  const project = await findProjectById(projectId)
  if (!project || project.deletedAt) return null

  if (project.userId === userId) {
    return {
      project,
      role: "owner",
      permissions: permissionsFor("owner"),
    }
  }

  const membership = await findProjectMembership(projectId, userId)
  if (!membership || !isProjectMemberRole(membership.role)) return null
  return {
    project,
    role: membership.role,
    permissions: permissionsFor(membership.role),
  }
}

/**
 * Проверка доступа для роутов кабинета — тех, что авторизуют сессионной кукой
 * (`requireUserApi`).
 *
 * Одноимённая функция есть и в lib/storage/auth.ts — не путать: та принимает
 * `StorageApiAuth` и умеет машинные токены, эта принимает `userId` и знает
 * только пользователей сайта. Роль обе считают одним и тем же кодом.
 *
 * Разница ответов намеренная: нет доступа вовсе — 404, чтобы чужой проект не
 * подтверждал сам факт своего существования; доступ есть, но роль ниже нужной —
 * 403 с внятным текстом, потому что человек проект видит и должен понять, почему
 * действие не прошло, а не решить, что проект исчез.
 */
export async function requireProjectAccess(
  projectId: string,
  userId: string,
  minimum: ProjectAccessRole = "viewer",
): Promise<ProjectAccess | NextResponse> {
  const access = await resolveProjectAccess(projectId, userId)
  if (!access) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  if (!roleAtLeast(access.role, minimum)) {
    return NextResponse.json(
      { message: forbiddenMessage(minimum) },
      { status: 403 },
    )
  }
  return access
}

function forbiddenMessage(minimum: ProjectAccessRole): string {
  switch (minimum) {
    case "editor":
      return "Read-only access to this project."
    case "full":
      return "Full access to this project is required."
    case "owner":
      return "Only the project owner can do this."
    default:
      return "Not enough access to this project."
  }
}
