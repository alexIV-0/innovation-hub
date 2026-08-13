import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type {
  AuthProvider,
  UserRecord,
  UserRecordWithPassword,
  UserRole,
} from "@/lib/domain-types"

const PUBLIC_USER_FIELDS = `
  id,
  full_name AS "fullName",
  email,
  role,
  is_active AS "isActive",
  created_at AS "createdAt",
  COALESCE(balance_cents, 0) AS "balanceCents",
  drive_folder_id AS "driveFolderId",
  COALESCE(must_change_password, FALSE) AS "mustChangePassword",
  COALESCE(automation_enabled, FALSE) AS "automationEnabled"
`

const FULL_USER_FIELDS = `
  id,
  full_name AS "fullName",
  email,
  password_hash AS "passwordHash",
  role,
  is_active AS "isActive",
  created_at AS "createdAt",
  auth_provider AS "authProvider",
  provider_account_id AS "providerAccountId",
  COALESCE(balance_cents, 0) AS "balanceCents",
  drive_folder_id AS "driveFolderId",
  COALESCE(must_change_password, FALSE) AS "mustChangePassword",
  COALESCE(automation_enabled, FALSE) AS "automationEnabled"
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

export async function listUsersByIds(ids: string[]): Promise<UserRecord[]> {
  if (ids.length === 0) return []
  const unique = [...new Set(ids)]
  const result = await query<UserRecord>(
    `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = ANY($1::text[])`,
    [unique],
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
    `INSERT INTO users (id, full_name, email, password_hash, role, auth_provider)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'USER'), 'local')
     RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, input.fullName, input.email, input.passwordHash, input.role ?? null],
  )
  return result.rows[0]
}

export async function findUserByProviderAccount(
  provider: AuthProvider,
  providerAccountId: string,
): Promise<UserRecordWithPassword | null> {
  const result = await query<UserRecordWithPassword>(
    `SELECT ${FULL_USER_FIELDS}
       FROM users
      WHERE auth_provider = $1 AND provider_account_id = $2`,
    [provider, providerAccountId],
  )
  return result.rows[0] ?? null
}

/** Creates a user that authenticates via an external OAuth provider. */
export async function createOAuthUser(input: {
  fullName: string
  email: string
  provider: AuthProvider
  providerAccountId: string
  role?: UserRole
}): Promise<UserRecord> {
  const id = randomUUID()
  const result = await query<UserRecord>(
    `INSERT INTO users (
        id, full_name, email, password_hash, role,
        auth_provider, provider_account_id
     )
     VALUES ($1, $2, $3, NULL, COALESCE($4, 'USER'), $5, $6)
     RETURNING ${PUBLIC_USER_FIELDS}`,
    [
      id,
      input.fullName,
      input.email,
      input.role ?? null,
      input.provider,
      input.providerAccountId,
    ],
  )
  return result.rows[0]
}

/**
 * Attaches an OAuth identity to an existing local account so that the user can
 * sign in with either method going forward. Used when a Google email matches an
 * existing email/password user — we don't silently replace the password, we
 * only fill in the provider columns.
 */
export async function linkProviderToUser(input: {
  userId: string
  provider: AuthProvider
  providerAccountId: string
}): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET auth_provider       = $2,
            provider_account_id = $3,
            updated_at          = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [input.userId, input.provider, input.providerAccountId],
  )
  return result.rows[0] ?? null
}

export async function updateUser(
  id: string,
  input: {
    fullName?: string
    email?: string
    passwordHash?: string
    role?: UserRole
    isActive?: boolean
    mustChangePassword?: boolean
  },
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET full_name     = COALESCE($2, full_name),
            email         = COALESCE($3, email),
            password_hash = COALESCE($4, password_hash),
            role          = COALESCE($5, role),
            is_active     = COALESCE($6, is_active),
            must_change_password = COALESCE($7, must_change_password),
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
      input.mustChangePassword ?? null,
    ],
  )
  return result.rows[0] ?? null
}

/**
 * Админский гейт конвейера. Отдельно от updateUser осознанно: это не свойство
 * аккаунта, а решение администратора про обработку, и меняется оно из другого
 * места интерфейса (/admin/pipeline, колонка пользователей).
 */
export async function setUserAutomationEnabled(
  id: string,
  enabled: boolean,
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET automation_enabled = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, enabled],
  )
  return result.rows[0] ?? null
}

export async function setUserDriveFolderId(
  id: string,
  driveFolderId: string,
): Promise<UserRecord | null> {
  const result = await query<UserRecord>(
    `UPDATE users
        SET drive_folder_id = $2,
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${PUBLIC_USER_FIELDS}`,
    [id, driveFolderId],
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
