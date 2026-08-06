import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { findUserById } from "@/lib/repositories/users"
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth"
import { query } from "@/lib/db"
import { findProjectForUser, findOwnedProject } from "@/lib/repositories/projects"
import { hashMachineToken } from "@/lib/storage/write-path"
import type { UserRole } from "@/lib/domain-types"

export type StorageApiAuth = {
  userId: string
  email: string
  role: UserRole
  machineTokenId: string | null
  scopedProjectId: string | null
}

function unauthorized(message = "Unauthorized.") {
  return NextResponse.json({ message }, { status: 401 })
}

function forbidden(message = "Forbidden.") {
  return NextResponse.json({ message }, { status: 403 })
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
    scopedProjectId: null,
  }
}

/** Session cookie or `Authorization: Bearer mch_…` machine token. */
export async function requireStorageApi(
  request: NextRequest,
): Promise<StorageApiAuth | NextResponse> {
  const authHeader = request.headers.get("authorization")
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim()
    const machine = await authFromMachineToken(token)
    if (!machine) return unauthorized("Invalid machine token.")
    return machine
  }

  const session = await authFromSession(request)
  if (!session) return unauthorized()
  return session
}

export async function requireProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
): Promise<NextResponse | { projectId: string }> {
  if (
    auth.scopedProjectId != null &&
    auth.scopedProjectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Machine token is scoped to another project." },
      { status: 403 },
    )
  }
  if (auth.role === "ADMIN") {
    return { projectId }
  }
  const project = await findProjectForUser(projectId, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return { projectId: project.id }
}

export async function requireOwnedProjectAccess(
  auth: StorageApiAuth,
  projectId: string,
): Promise<NextResponse | { projectId: string }> {
  if (
    auth.scopedProjectId != null &&
    auth.scopedProjectId !== projectId
  ) {
    return NextResponse.json(
      { message: "Machine token is scoped to another project." },
      { status: 403 },
    )
  }
  if (auth.role === "ADMIN") {
    return { projectId }
  }
  const project = await findOwnedProject(projectId, auth.userId)
  if (!project) {
    return NextResponse.json({ message: "Project not found." }, { status: 404 })
  }
  return { projectId: project.id }
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

export async function revokeMachineToken(userId: string, tokenId: string) {
  await query(
    `UPDATE machine_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2`,
    [tokenId, userId],
  )
}
