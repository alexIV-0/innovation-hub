import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { findUserById } from "@/lib/repositories/users"
import {
  findActiveRemoteComputerByTokenHash,
} from "@/lib/repositories/remote-computers"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { query } from "@/lib/db"
import {
  findOwnedProject,
  findProjectById,
} from "@/lib/repositories/projects"
import { findProjectMembership } from "@/lib/repositories/project-members"
import { hashMachineToken, type StorageActor } from "@/lib/storage/write-path"
import type { UserRole } from "@/lib/domain-types"

export type StorageApiAuth = {
  userId: string
  email: string
  role: UserRole
  machineTokenId: string | null
  computerId: string | null
  scopedProjectId: string | null
}

/**
 * Актор записи из авторизации запроса.
 *
 * Машина парка (`rc_`) заливщиком не считается: она возвращает результаты в
 * проект, а `uploaded_by` отвечает на вопрос «кто принёс исходник». Её `userId` —
 * это `remote_computers.created_by`, то есть админ, регистрировавший компьютер, и
 * переносить на него contact задачи было бы прямым искажением.
 */
export function actorFromAuth(auth: StorageApiAuth): StorageActor {
  return { userId: auth.userId, isUploader: auth.computerId == null }
}

export type ProjectAccessRole = "owner" | "editor" | "viewer"

export type StorageProjectAccess = {
  projectId: string
  ownerId: string
  accessRole: ProjectAccessRole
}

function unauthorized(message = "Unauthorized.") {
  return NextResponse.json({ message }, { status: 401 })
}

/** Resolve site-user access: owner, shared member, or null. Machine tokens never use this. */
export async function resolveProjectAccess(
  projectId: string,
  userId: string,
): Promise<{ role: ProjectAccessRole; ownerId: string } | null> {
  const project = await findProjectById(projectId)
  if (!project || project.deletedAt) return null
  if (project.userId === userId) {
    return { role: "owner", ownerId: project.userId }
  }
  const membership = await findProjectMembership(projectId, userId)
  if (!membership) return null
  return { role: membership.role, ownerId: project.userId }
}

function roleAtLeast(
  role: ProjectAccessRole,
  minimum: ProjectAccessRole,
): boolean {
  const rank = { viewer: 1, editor: 2, owner: 3 }
  return rank[role] >= rank[minimum]
}

async function authFromRemoteComputerToken(
  token: string,
): Promise<(StorageApiAuth & { computerName: string }) | null> {
  if (!token.startsWith("rc_")) return null
  const tokenHash = hashMachineToken(token)
  const row = await findActiveRemoteComputerByTokenHash(tokenHash)
  if (!row || !row.isActive) return null

  return {
    userId: row.createdBy,
    email: row.email,
    role: "ADMIN",
    machineTokenId: null,
    computerId: row.id,
    scopedProjectId: null,
    computerName: row.name,
  }
}

async function authFromMachineToken(
  token: string,
): Promise<(StorageApiAuth & { scopedProjectId: string | null }) | null> {
  const tokenHash = hashMachineToken(token)
  const result = await query<{
    id: string
    userId: string
    projectId: string | null
    email: string
    role: UserRole
    isActive: boolean
  }>(
    `SELECT mt.id,
            mt.user_id AS "userId",
            mt.project_id AS "projectId",
            u.email,
            u.role,
            u.is_active AS "isActive"
       FROM machine_tokens mt
       JOIN users u ON u.id = mt.user_id
      WHERE mt.token_hash = $1
        AND mt.revoked_at IS NULL`,
    [tokenHash],
  )
  const row = result.rows[0]
  if (!row || !row.isActive) return null

  await query(`UPDATE machine_tokens SET last_used_at = NOW() WHERE id = $1`, [
    row.id,
  ])

  return {
    userId: row.userId,
    email: row.email,
    role: row.role,
    machineTokenId: row.id,
    computerId: null,
    scopedProjectId: row.projectId,
  }
}

async function authFromSession(
  request: NextRequest,
): Promise<StorageApiAuth | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  const session = await verifySessionToken(token)
  if (!session?.userId) return null
  const user = await findUserById(session.userId)
  if (!user || !user.isActive) return null
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    machineTokenId: null,
    computerId: null,
    scopedProjectId: null,
  }
}

/** Session cookie, `Authorization: Bearer mch_…`, or `Bearer rc_…`. */
export async function requireStorageApi(
  request: NextRequest,
): Promise<StorageApiAuth | NextResponse> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim()
    if (token.startsWith("rc_")) {
      const computer = await authFromRemoteComputerToken(token)
      if (!computer) return unauthorized("Invalid computer token.")
      return computer
    }
    const machine = await authFromMachineToken(token)
    if (!machine) return unauthorized("Invalid machine token.")
    return machine
  }

  const session = await authFromSession(request)
  if (!session) return unauthorized()
  return session
}

/** Authenticate a raw `rc_…` token from the machine API body. */
export async function authenticateComputerToken(
  token: string,
): Promise<StorageApiAuth | null> {
  const computer = await authFromRemoteComputerToken(token.trim())
  if (!computer?.computerId) return null
  return computer
}

export async function requireProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
  minimum: ProjectAccessRole = "viewer",
): Promise<NextResponse | StorageProjectAccess> {
  if (
    auth.scopedProjectId != null &&
    auth.scopedProjectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Machine token is scoped to another project." },
      { status: 403 },
    )
  }

  // Machine / computer tokens: ownership only (no sharing).
  if (auth.machineTokenId || auth.computerId) {
    const project =
      auth.role === "ADMIN"
        ? await findProjectById(projectId)
        : await findOwnedProject(projectId, auth.userId)
    if (!project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
    return {
      projectId: project.id,
      ownerId: project.ownerId,
      accessRole: "owner",
    }
  }

  if (auth.role === "ADMIN") {
    const project = await findProjectById(projectId)
    if (!project) {
      return NextResponse.json({ message: "Project not found." }, { status: 404 })
    }
    return {
      projectId: project.id,
      ownerId: project.ownerId,
      accessRole: "owner",
    }
  }

  const resolved = await resolveProjectAccess(projectId, auth.userId)
  if (!resolved || !roleAtLeast(resolved.role, minimum)) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return {
    projectId,
    ownerId: resolved.ownerId,
    accessRole: resolved.role,
  }
}

/** File writes: editor+ on the site; ownership for machine tokens. */
export async function requireEditableProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
): Promise<NextResponse | StorageProjectAccess> {
  return requireProjectAccess(auth, projectId, "editor")
}

export async function requireOwnedProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
): Promise<NextResponse | StorageProjectAccess> {
  if (
    auth.scopedProjectId != null &&
    auth.scopedProjectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Machine token is scoped to another project." },
      { status: 403 },
    )
  }
  const project =
    auth.role === "ADMIN"
      ? await findProjectById(projectId)
      : await findOwnedProject(projectId, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return {
    projectId: project.id,
    ownerId: project.ownerId,
    accessRole: "owner",
  }
}

export async function createMachineToken(input: {
  userId: string
  name: string
  projectId?: string | null
  rawToken: string
}): Promise<{ id: string; token: string }> {
  const id = randomUUID()
  const tokenHash = hashMachineToken(input.rawToken)
  await query(
    `INSERT INTO machine_tokens (id, user_id, project_id, name, token_hash)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, input.userId, input.projectId ?? null, input.name, tokenHash],
  )
  return { id, token: input.rawToken }
}

export async function listMachineTokens(userId: string) {
  const result = await query<{
    id: string
    name: string
    projectId: string | null
    createdAt: Date
    lastUsedAt: Date | null
  }>(
    `SELECT id, name, project_id AS "projectId", created_at AS "createdAt", last_used_at AS "lastUsedAt"
       FROM machine_tokens
      WHERE user_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC`,
    [userId],
  )
  return result.rows
}

/**
 * Отзывает токен и вместе с ним — машины, которые под ним ходили.
 *
 * Второе обязательно: машина существует в списке только как «кто обращался этим
 * токеном». Оставить её после отзыва означало бы показывать парк машин, которого
 * больше нет — ходить она всё равно не сможет, авторизация откажет.
 *
 * Машины помечаются отозванными, а не удаляются: та же машина по своему UUID
 * спокойно заведётся заново под новым токеном (частичный уникальный индекс
 * считает только неотозванные), а история останется.
 */
export async function revokeMachineToken(userId: string, tokenId: string) {
  const result = await query(
    `UPDATE machine_tokens SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  )
  if ((result.rowCount ?? 0) === 0) return

  const { revokeComputersByToken } = await import(
    "@/lib/repositories/remote-computers"
  )
  await revokeComputersByToken(tokenId)
}
