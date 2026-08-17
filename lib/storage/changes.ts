import type { PoolClient, QueryResultRow } from "pg"
import { query } from "@/lib/db"
import type {
  StorageChangeOp,
  StorageChangePayload,
  StorageChangeRecord,
} from "@/lib/storage/types"

const CHANGE_RETENTION_DAYS = 90

type ChangeRow = QueryResultRow & {
  seq: string
  projectId: string
  key: string
  op: StorageChangeOp
  size: string | null
  etag: string | null
  contentHash: string | null
  eventTime: number
  eventId: string | null
  payload: StorageChangePayload
}

function mapRow(row: ChangeRow): StorageChangeRecord {
  return {
    seq: Number(row.seq),
    projectId: row.projectId,
    key: row.key,
    op: row.op,
    size: row.size != null ? Number(row.size) : null,
    etag: row.etag,
    contentHash: row.contentHash,
    eventTime: row.eventTime,
    eventId: row.eventId,
    payload: row.payload ?? {},
  }
}

export function nowUnixSec(): number {
  return Math.floor(Date.now() / 1000)
}

export async function appendStorageChange(
  client: PoolClient,
  input: {
    projectId: string
    key: string
    op: StorageChangeOp
    size?: number | null
    etag?: string | null
    contentHash?: string | null
    eventTime?: number
    eventId?: string | null
    /** Пользователь сайта, совершивший запись; null — записи без человека. */
    actorUserId?: string | null
    payload?: StorageChangePayload
  },
): Promise<number> {
  const result = await client.query<{ seq: string }>(
    `INSERT INTO storage_changes (
        project_id, key, op, size, etag, content_hash, event_time, event_id,
        actor_user_id, payload
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING seq`,
    [
      input.projectId,
      input.key,
      input.op,
      input.size ?? null,
      input.etag ?? null,
      input.contentHash ?? null,
      input.eventTime ?? nowUnixSec(),
      input.eventId ?? null,
      input.actorUserId ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  )
  if (result.rows[0]) return Number(result.rows[0].seq)

  if (input.eventId) {
    const existing = await client.query<{ seq: string }>(
      `SELECT seq FROM storage_changes WHERE event_id = $1`,
      [input.eventId],
    )
    if (existing.rows[0]) return Number(existing.rows[0].seq)
  }

  const latest = await client.query<{ seq: string }>(
    `SELECT seq FROM storage_changes ORDER BY seq DESC LIMIT 1`,
  )
  return latest.rows[0] ? Number(latest.rows[0].seq) : 0
}

export async function getDelta(input: {
  projectId: string
  since: number
}): Promise<{ changes: StorageChangeRecord[]; cursor: number; truncated: boolean }> {
  const cutoff = nowUnixSec() - CHANGE_RETENTION_DAYS * 86400
  const minSeq = await query<{ minSeq: string | null }>(
    `SELECT MIN(seq)::text AS "minSeq"
       FROM storage_changes
      WHERE project_id = $1
        AND event_time >= $2`,
    [input.projectId, cutoff],
  )
  const oldest = minSeq.rows[0]?.minSeq ? Number(minSeq.rows[0].minSeq) : null
  const truncated = oldest != null && input.since > 0 && input.since < oldest - 1

  const result = await query<ChangeRow>(
    `SELECT seq::text,
            project_id AS "projectId",
            key,
            op,
            size::text,
            etag,
            content_hash AS "contentHash",
            event_time AS "eventTime",
            event_id AS "eventId",
            payload
       FROM storage_changes
      WHERE project_id = $1
        AND seq > $2
      ORDER BY seq ASC
      LIMIT 5000`,
    [input.projectId, input.since],
  )

  const changes = result.rows.map(mapRow)
  const cursor =
    changes.length > 0 ? changes[changes.length - 1]!.seq : input.since

  return { changes, cursor, truncated }
}

export async function getLatestCursor(projectId: string): Promise<number> {
  const result = await query<{ seq: string | null }>(
    `SELECT MAX(seq)::text AS seq
       FROM storage_changes
      WHERE project_id = $1`,
    [projectId],
  )
  return result.rows[0]?.seq ? Number(result.rows[0].seq) : 0
}
