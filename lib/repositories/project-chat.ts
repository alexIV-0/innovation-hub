import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type {
  ProjectChatMessageRecord,
  ProjectChatSenderType,
} from "@/lib/domain-types"

const MESSAGE_FIELDS = `
  id,
  project_id AS "projectId",
  sender_type AS "senderType",
  sender_user_id AS "senderUserId",
  sender_name AS "senderName",
  body,
  yougile_message_id AS "yougileMessageId",
  delivered,
  created_at AS "createdAt"
`

export async function listProjectChatMessages(
  projectId: string,
): Promise<ProjectChatMessageRecord[]> {
  const result = await query<ProjectChatMessageRecord>(
    `SELECT ${MESSAGE_FIELDS}
       FROM project_chat_messages
      WHERE project_id = $1
      ORDER BY created_at ASC`,
    [projectId],
  )
  return result.rows
}

export async function insertProjectChatMessage(input: {
  projectId: string
  senderType: ProjectChatSenderType
  senderUserId?: string | null
  senderName: string
  body: string
  yougileMessageId?: string | null
  delivered?: boolean
  /**
   * Overrides `created_at` (defaults to NOW()) — used when backfilling
   * messages pulled from YouGile's own history, so they sort by when they
   * were actually sent there instead of when we happened to poll them.
   */
  createdAt?: Date
}): Promise<ProjectChatMessageRecord> {
  const id = randomUUID()
  const result = await query<ProjectChatMessageRecord>(
    `INSERT INTO project_chat_messages (
        id, project_id, sender_type, sender_user_id, sender_name, body,
        yougile_message_id, delivered, created_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, NOW()))
     RETURNING ${MESSAGE_FIELDS}`,
    [
      id,
      input.projectId,
      input.senderType,
      input.senderUserId ?? null,
      input.senderName,
      input.body,
      input.yougileMessageId ?? null,
      input.delivered ?? false,
      input.createdAt ?? null,
    ],
  )
  return result.rows[0]
}

/** Marks a client message as successfully pushed into the YouGile chat. */
export async function markProjectChatMessageDelivered(
  id: string,
  yougileMessageId: string,
): Promise<void> {
  await query(
    `UPDATE project_chat_messages
        SET yougile_message_id = $2,
            delivered = TRUE
      WHERE id = $1`,
    [id, yougileMessageId],
  )
}

/**
 * Dedup guard for the webhook receiver: a message already recorded under
 * this YouGile message id (e.g. our own echoed send, or a retried webhook
 * delivery) should not be inserted again.
 */
export async function findProjectChatMessageByYougileId(
  yougileMessageId: string,
): Promise<ProjectChatMessageRecord | null> {
  const result = await query<ProjectChatMessageRecord>(
    `SELECT ${MESSAGE_FIELDS}
       FROM project_chat_messages
      WHERE yougile_message_id = $1`,
    [yougileMessageId],
  )
  return result.rows[0] ?? null
}

/**
 * Unread badge counts for a set of projects: messages from 'team'/'system'
 * created after `projects.chat_last_read_at` (NULL = never opened, so
 * everything counts). One project has exactly one owning user, so a single
 * timestamp column is enough — no per-user read-state table needed.
 */
export async function countUnreadForProjects(
  projectIds: string[],
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}

  const result = await query<{ projectId: string; count: number }>(
    `SELECT m.project_id AS "projectId", COUNT(*)::int AS count
       FROM project_chat_messages m
       JOIN projects p ON p.id = m.project_id
      WHERE m.project_id = ANY($1)
        AND m.sender_type IN ('team', 'system')
        AND m.created_at > COALESCE(p.chat_last_read_at, '-infinity')
      GROUP BY m.project_id`,
    [projectIds],
  )

  const counts: Record<string, number> = {}
  for (const id of projectIds) counts[id] = 0
  for (const row of result.rows) counts[row.projectId] = row.count
  return counts
}

/** Marks a project's chat as read up to now — clears its unread badge. */
export async function markProjectChatRead(projectId: string): Promise<void> {
  await query(`UPDATE projects SET chat_last_read_at = NOW() WHERE id = $1`, [
    projectId,
  ])
}
