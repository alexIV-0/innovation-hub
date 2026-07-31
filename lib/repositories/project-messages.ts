import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"
import type {
  MessageSenderRole,
  ProjectMessageRecord,
} from "@/lib/domain-types"

const MESSAGE_FIELDS = `
  id,
  project_id AS "projectId",
  sender_id AS "senderId",
  sender_role AS "senderRole",
  text,
  created_at AS "createdAt",
  read_by_user AS "readByUser",
  read_by_team AS "readByTeam"
`

export async function listMessages(
  projectId: string,
): Promise<ProjectMessageRecord[]> {
  const result = await query<ProjectMessageRecord>(
    `SELECT ${MESSAGE_FIELDS}
       FROM project_messages
      WHERE project_id = $1
      ORDER BY created_at ASC`,
    [projectId],
  )
  return result.rows
}

export async function createMessage(input: {
  projectId: string
  senderId: string
  senderRole: MessageSenderRole
  text: string
}): Promise<ProjectMessageRecord> {
  const id = randomUUID()
  const readByUser = input.senderRole === "user"
  const readByTeam = input.senderRole === "team"

  const result = await query<ProjectMessageRecord>(
    `INSERT INTO project_messages (
        id, project_id, sender_id, sender_role, text, read_by_user, read_by_team
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${MESSAGE_FIELDS}`,
    [
      id,
      input.projectId,
      input.senderId,
      input.senderRole,
      input.text,
      readByUser,
      readByTeam,
    ],
  )
  return result.rows[0]
}

export async function markMessagesReadByUser(projectId: string): Promise<void> {
  await query(
    `UPDATE project_messages
        SET read_by_user = TRUE
      WHERE project_id = $1
        AND sender_role = 'team'
        AND read_by_user = FALSE`,
    [projectId],
  )
}

export async function countUnreadForOwner(ownerId: string): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM project_messages m
       JOIN projects p ON p.id = m.project_id
      WHERE p.user_id = $1
        AND m.sender_role = 'team'
        AND m.read_by_user = FALSE`,
    [ownerId],
  )
  return result.rows[0]?.count ?? 0
}
