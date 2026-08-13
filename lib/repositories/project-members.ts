import { query } from "@/lib/db"

export type ProjectMemberRole = "viewer" | "editor"

export type ProjectMemberRecord = {
  projectId: string
  userId: string
  role: ProjectMemberRole
  invitedBy: string | null
  createdAt: Date
  email?: string
  fullName?: string
}

export async function listProjectMembers(
  projectId: string,
): Promise<ProjectMemberRecord[]> {
  const result = await query<ProjectMemberRecord>(
    `SELECT pm.project_id AS "projectId",
            pm.user_id AS "userId",
            pm.role,
            pm.invited_by AS "invitedBy",
            pm.created_at AS "createdAt",
            u.email,
            u.full_name AS "fullName"
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.created_at ASC`,
    [projectId],
  )
  return result.rows
}

export async function findProjectMembership(
  projectId: string,
  userId: string,
): Promise<ProjectMemberRecord | null> {
  const result = await query<ProjectMemberRecord>(
    `SELECT project_id AS "projectId",
            user_id AS "userId",
            role,
            invited_by AS "invitedBy",
            created_at AS "createdAt"
       FROM project_members
      WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  return result.rows[0] ?? null
}

export async function upsertProjectMember(input: {
  projectId: string
  userId: string
  role: ProjectMemberRole
  invitedBy: string | null
}): Promise<ProjectMemberRecord> {
  const result = await query<ProjectMemberRecord>(
    `INSERT INTO project_members (project_id, user_id, role, invited_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (project_id, user_id)
     DO UPDATE SET role = EXCLUDED.role
     RETURNING project_id AS "projectId",
               user_id AS "userId",
               role,
               invited_by AS "invitedBy",
               created_at AS "createdAt"`,
    [input.projectId, input.userId, input.role, input.invitedBy],
  )
  return result.rows[0]!
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2`,
    [projectId, userId],
  )
  return (result.rowCount ?? 0) > 0
}

export async function listSharedProjectsForUser(userId: string) {
  const result = await query<{
    id: string
    ownerId: string
    userId: string
    name: string
    description: string
    groupName: string
    isPaused: boolean
    driveFolderId: string | null
    isActive: boolean
    isArchived: boolean
    archivedAt: Date | null
    deletedAt: Date | null
    clientId: string | null
    createdAt: Date
    updatedAt: Date
    yougileChatId: string | null
    memberRole: ProjectMemberRole
  }>(
    `SELECT p.id,
            p.user_id AS "ownerId",
            p.user_id AS "userId",
            p.name,
            COALESCE(p.description, '') AS description,
            COALESCE(p.group_name, 'personal') AS "groupName",
            COALESCE(p.is_paused, FALSE) AS "isPaused",
            p.drive_folder_id AS "driveFolderId",
            NOT COALESCE(p.is_paused, FALSE) AS "isActive",
            COALESCE(p.is_archived, FALSE) AS "isArchived",
            p.archived_at AS "archivedAt",
            p.deleted_at AS "deletedAt",
            p.client_id AS "clientId",
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            p.yougile_chat_id AS "yougileChatId",
            pm.role AS "memberRole"
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
      WHERE pm.user_id = $1
        AND p.deleted_at IS NULL
      ORDER BY p.updated_at DESC`,
    [userId],
  )
  return result.rows
}
