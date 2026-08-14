import { randomBytes, randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import {
  REMOTE_COMPUTER_ONLINE_MS,
  type RemoteComputerRecord,
  type RemoteComputerStatus,
} from "@/lib/domain-types"
import { hashMachineToken } from "@/lib/storage/write-path"

const COMPUTER_FIELDS = `
  rc.id,
  rc.name,
  rc.description,
  rc.status,
  rc.current_project_id AS "currentProjectId",
  rc.current_task AS "currentTask",
  rc.last_heartbeat_at AS "lastHeartbeatAt",
  rc.meta,
  rc.created_by AS "createdBy",
  rc.created_at AS "createdAt",
  rc.revoked_at AS "revokedAt"
`

export type RemoteComputerListItem = RemoteComputerRecord & {
  online: boolean
  currentProjectName: string | null
}

export type RemoteComputerAuthRow = {
  id: string
  name: string
  createdBy: string
  email: string
  isActive: boolean
}

function parseMeta(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

function mapRecord(row: RemoteComputerRecord): RemoteComputerRecord {
  return {
    ...row,
    meta: parseMeta(row.meta),
  }
}

export function isRemoteComputerOnline(
  lastHeartbeatAt: Date | null,
  revokedAt: Date | null = null,
): boolean {
  if (revokedAt) return false
  if (!lastHeartbeatAt) return false
  return Date.now() - lastHeartbeatAt.getTime() <= REMOTE_COMPUTER_ONLINE_MS
}

export function generateRemoteComputerToken(): string {
  return `rc_${randomBytes(32).toString("base64url")}`
}

export async function listRemoteComputers(): Promise<RemoteComputerListItem[]> {
  const result = await query<
    RemoteComputerRecord & { currentProjectName: string | null }
  >(
    `SELECT ${COMPUTER_FIELDS},
            p.name AS "currentProjectName"
       FROM remote_computers rc
  LEFT JOIN projects p ON p.id = rc.current_project_id
      WHERE rc.revoked_at IS NULL
      ORDER BY rc.created_at DESC`,
  )
  return result.rows.map((row) => {
    const record = mapRecord(row)
    return {
      ...record,
      currentProjectName: row.currentProjectName,
      online: isRemoteComputerOnline(record.lastHeartbeatAt, record.revokedAt),
    }
  })
}

export async function findRemoteComputerById(
  id: string,
): Promise<RemoteComputerRecord | null> {
  const result = await query<RemoteComputerRecord>(
    `SELECT ${COMPUTER_FIELDS}
       FROM remote_computers rc
      WHERE rc.id = $1`,
    [id],
  )
  const row = result.rows[0]
  return row ? mapRecord(row) : null
}

export async function findActiveRemoteComputerByTokenHash(
  tokenHash: string,
): Promise<RemoteComputerAuthRow | null> {
  const result = await query<RemoteComputerAuthRow>(
    `SELECT rc.id,
            rc.name,
            rc.created_by AS "createdBy",
            u.email,
            u.is_active AS "isActive"
       FROM remote_computers rc
       JOIN users u ON u.id = rc.created_by
      WHERE rc.token_hash = $1
        AND rc.revoked_at IS NULL`,
    [tokenHash],
  )
  return result.rows[0] ?? null
}

export async function createRemoteComputer(input: {
  name: string
  description?: string
  createdBy: string
  rawToken: string
}): Promise<{ id: string; token: string; name: string }> {
  const id = randomUUID()
  const tokenHash = hashMachineToken(input.rawToken)
  await query(
    `INSERT INTO remote_computers (id, name, description, token_hash, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      id,
      input.name,
      input.description?.trim() ?? "",
      tokenHash,
      input.createdBy,
    ],
  )
  return { id, token: input.rawToken, name: input.name }
}

/**
 * Находит машину по её UUID или заводит новую.
 *
 * Заводить компьютер в админке руками не нужно: машина приходит со своим UUID,
 * сгенерированным один раз при первом запуске, и сайт создаёт строку сам
 * (PIPELINE_BACKEND_REQUESTS.md §4).
 *
 * Почему UUID, а не hostname: дефолтные имена маков совпадают сплошь и рядом, и
 * на совпадении ломается не очередь, а архив статистики — две машины начнут
 * писать в один объект, а в объектном хранилище нет дописывания в конец, заливка
 * перезаписывает объект целиком и строки затрутся тихо. Hostname остаётся
 * человекочитаемой подписью в `name` и обновляется на каждом обращении: машину
 * могли переименовать.
 *
 * `token_hash` у самозаписанной машины синтетический: она ходит своим `mch_`
 * токеном, а не выданным `rc_`, и подобрать этот хеш нечем — он не хеш токена.
 */
export async function ensureRemoteComputerByUuid(input: {
  machineUuid: string
  hostname?: string | null
  /** Владелец токена, которым пришла машина. */
  userId: string
}): Promise<{ id: string; name: string; created: boolean }> {
  const uuid = input.machineUuid.trim()
  const label = input.hostname?.trim() || `machine-${uuid.slice(0, 8)}`

  const existing = await query<{ id: string; name: string }>(
    `SELECT id, name FROM remote_computers
      WHERE machine_uuid = $1 AND revoked_at IS NULL`,
    [uuid],
  )
  if (existing.rows[0]) {
    const row = existing.rows[0]
    if (input.hostname?.trim() && row.name !== label) {
      await query(`UPDATE remote_computers SET name = $2 WHERE id = $1`, [
        row.id,
        label,
      ])
    }
    return { id: row.id, name: label, created: false }
  }

  const id = randomUUID()
  const inserted = await query<{ id: string }>(
    `INSERT INTO remote_computers
       (id, name, description, token_hash, machine_uuid, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      id,
      label,
      "Заведена автоматически при первом обращении машины.",
      `self:${uuid}`,
      uuid,
      input.userId,
    ],
  )

  // Ноль строк — параллельная самозапись той же машины успела раньше.
  if (inserted.rows.length === 0) {
    const race = await query<{ id: string; name: string }>(
      `SELECT id, name FROM remote_computers
        WHERE machine_uuid = $1 AND revoked_at IS NULL`,
      [uuid],
    )
    const row = race.rows[0]
    if (!row) throw new Error(`Failed to register machine ${uuid}.`)
    return { id: row.id, name: row.name, created: false }
  }

  return { id, name: label, created: true }
}

export async function updateRemoteComputer(
  id: string,
  patch: { name?: string; description?: string },
): Promise<RemoteComputerRecord | null> {
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) return null

  const name = patch.name?.trim() ?? existing.name
  const description =
    patch.description !== undefined
      ? patch.description.trim()
      : existing.description

  await query(
    `UPDATE remote_computers
        SET name = $2, description = $3
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, name, description],
  )
  return findRemoteComputerById(id)
}

export async function revokeRemoteComputer(id: string): Promise<boolean> {
  const result = await query(
    `UPDATE remote_computers
        SET revoked_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export async function rotateRemoteComputerToken(
  id: string,
  rawToken: string,
): Promise<boolean> {
  const tokenHash = hashMachineToken(rawToken)
  const result = await query(
    `UPDATE remote_computers
        SET token_hash = $2
      WHERE id = $1 AND revoked_at IS NULL`,
    [id, tokenHash],
  )
  return (result.rowCount ?? 0) > 0
}

export async function heartbeatRemoteComputer(
  id: string,
  input: {
    status?: RemoteComputerStatus
    currentProjectId?: string | null
    currentTask?: string | null
    meta?: Record<string, unknown>
  },
): Promise<RemoteComputerRecord | null> {
  const existing = await findRemoteComputerById(id)
  if (!existing || existing.revokedAt) return null

  const status = input.status ?? existing.status
  const currentProjectId =
    input.currentProjectId !== undefined
      ? input.currentProjectId
      : existing.currentProjectId
  const currentTask =
    input.currentTask !== undefined ? input.currentTask : existing.currentTask
  const meta = input.meta !== undefined ? input.meta : existing.meta

  await query(
    `UPDATE remote_computers
        SET status = $2,
            current_project_id = $3,
            current_task = $4,
            meta = $5::jsonb,
            last_heartbeat_at = NOW()
      WHERE id = $1 AND revoked_at IS NULL`,
    [
      id,
      status,
      currentProjectId,
      currentTask,
      JSON.stringify(meta ?? {}),
    ],
  )
  return findRemoteComputerById(id)
}

export function toRemoteComputerPublic(
  record: RemoteComputerRecord,
): RemoteComputerListItem & { online: boolean } {
  return {
    ...record,
    currentProjectName: null,
    online: isRemoteComputerOnline(record.lastHeartbeatAt, record.revokedAt),
  }
}
