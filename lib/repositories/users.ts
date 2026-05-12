import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type { UserRecord, UserRecordWithPassword, UserRole } from "@/lib/domain-types"

const PUBLIC_USER_FIELDS = `
  id,
  full_name AS "fullName",
  email,
  role,
  is_active AS "isActive",
  created_at AS "createdAt"
`

const FULL_USER_FIELDS = `
  id,
  full_name AS "fullName",
  email,
  password_hash AS "passwordHash",
  role,
  is_active AS "isActive",
  created_at AS "createdAt"
`

export async function findUserById(id: string): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function findUserByEmail(
  email: string,
): Promise<UserRecordWithPassword | null> {
  const result = await query<UserRecordWithPassword>(
    `SELECT ${FULL_USER_FIELDS} FROM users WHERE email = $1`,
    [email],
  )
  return result.rows[0] ?? null
}

export async function listUsers(): Promise<UserRecord[]> {
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users ORDER BY created_at DESC`,
  )
  return result.rows
}

/** Counts active admins, optionally excluding a given user id. */
export async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  if (excludeUserId) {
    const result = await query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM users
        WHERE role = 'ADMIN' AND is_active = TRUE AND id <> $1`,
      [excludeUserId],
    )
    return result.rows[0]?.count ?? 0
  }
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM users
      WHERE role = 'ADMIN' AND is_active = TRUE`,
  )
  return result.rows[0]?.count ?? 0
}

export async function createUser(input: {
  fullName: string
  email: string
  passwordHash: string
  role?: UserRole
}): Promise<UserRecord> {
  const id = randomUUID()
  const result = await query<UserRecord>(
    `INSERT INTO users (id, full_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'USER'))
     RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, input.fullName, input.email, input.passwordHash, input.role ?? null],
  )
  return result.rows[0]
}

export async function updateUser(
  id: string,
  input: {
    fullName?: string
    email?: string
    passwordHash?: string
    role?: UserRole
    isActive?: boolean
  },
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET full_name     = COALESCE($2, full_name),
            email         = COALESCE($3, email),
            password_hash = COALESCE($4, password_hash),
            role          = COALESCE($5, role),
            is_active     = COALESCE($6, is_active),
            updated_at    = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [
      id,
      input.fullName ?? null,
      input.email ?? null,
      input.passwordHash ?? null,
      input.role ?? null,
      input.isActive ?? null,
    ],
  )
  return result.rows[0] ?? null
}

export async function deleteUser(id: string) {
  await query(`DELETE FROM users WHERE id = $1`, [id])
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`Email already registered: ${email}`)
    this.name = "DuplicateEmailError"
  }
}
