import { query } from "@/lib/db"
import type { ProjectRecord } from "@/lib/domain-types"

/**
 * Запросы «Конвейера» — админского вида на обработку всех проектов сайта.
 *
 * Ключевое отличие от кабинетных запросов: здесь нет владельческого скоупинга,
 * зато есть гейт пользователя (users.automation_enabled) и признаки, по которым
 * проект попадает или не попадает под слежение.
 */

export type PipelineUser = {
  id: string
  fullName: string
  email: string
  automationEnabled: boolean
  /** Аккаунт не заблокирован. Заблокированного не обрабатываем независимо от гейта. */
  isActive: boolean
  projectCount: number
  /** Не на паузе и не в архиве — то есть под слежением, если гейт включён. */
  watchedCount: number
  archivedCount: number
  /** Последняя активность в хранилище по любому проекту пользователя. */
  lastActivityAt: Date | null
}

export async function listPipelineUsers(): Promise<PipelineUser[]> {
  const result = await query<PipelineUser>(
    `SELECT u.id,
            COALESCE(u.full_name, '')        AS "fullName",
            u.email,
            COALESCE(u.automation_enabled, FALSE) AS "automationEnabled",
            u.is_active                     AS "isActive",
            COALESCE(p.total, 0)::int       AS "projectCount",
            COALESCE(p.watched, 0)::int     AS "watchedCount",
            COALESCE(p.archived, 0)::int    AS "archivedCount",
            p.last_activity                 AS "lastActivityAt"
       FROM users u
       LEFT JOIN (
         SELECT user_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (
                  WHERE COALESCE(is_paused, FALSE) = FALSE
                    AND COALESCE(is_archived, FALSE) = FALSE
                ) AS watched,
                COUNT(*) FILTER (WHERE COALESCE(is_archived, FALSE)) AS archived,
                MAX(updated_at) AS last_activity
           FROM projects
          GROUP BY user_id
       ) p ON p.user_id = u.id
      ORDER BY COALESCE(u.automation_enabled, FALSE) DESC,
               COALESCE(p.total, 0) DESC,
               u.email ASC`,
  )
  return result.rows
}

export type PipelineProject = ProjectRecord & {
  /** Гейт владельца — проект не следится, даже если сам не на паузе. */
  ownerAutomationEnabled: boolean
  ownerEmail: string
  /**
   * Сообщения клиента, на которые ещё не ответили.
   *
   * Отметки «команда прочитала» в схеме нет, но она и не нужна: админка и
   * YouGile — это один и тот же чат с двух сторон, поэтому «не отвечено»
   * выводится из самой переписки — сообщения клиента после последнего ответа
   * команды. Ответили в YouGile — обратная синхронизация принесёт строку
   * sender_type = 'team', и счётчик обнулится сам; ответили в админке — строка
   * появится сразу.
   */
  unreadCount: number
  /** Скольким людям расшарен проект, не считая владельца. */
  memberCount: number
}

/**
 * Проекты одного пользователя для колонки 2, включая архивные: админ должен
 * видеть их и понимать, что они не обрабатываются.
 */
export async function listPipelineProjectsByOwner(
  ownerId: string,
): Promise<PipelineProject[]> {
  const result = await query<PipelineProject>(
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
            p.client_id AS "clientId",
            p.created_at AS "createdAt",
            p.updated_at AS "updatedAt",
            p.yougile_chat_id AS "yougileChatId",
            COALESCE(u.automation_enabled, FALSE) AS "ownerAutomationEnabled",
            u.email AS "ownerEmail",
            COALESCE((
              SELECT COUNT(*)::int
                FROM project_chat_messages m
               WHERE m.project_id = p.id
                 AND m.sender_type = 'client'
                 AND m.created_at > COALESCE((
                       SELECT MAX(a.created_at)
                         FROM project_chat_messages a
                        WHERE a.project_id = p.id
                          AND a.sender_type = 'team'
                     ), '-infinity'::timestamptz)
            ), 0) AS "unreadCount",
            -- Расшаренность показываем числом, но НЕ раскрываем, кому именно:
            -- проект принадлежит владельцу, а с кем он им делится — не вопрос
            -- конвейера. Владельца из счёта исключаем, чтобы число означало
            -- «скольким расшарили» (см. countProjectMembers).
            COALESCE((
              SELECT COUNT(*)::int
                FROM project_members pm
               WHERE pm.project_id = p.id
                 AND pm.user_id <> p.user_id
            ), 0) AS "memberCount"
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE p.user_id = $1
      ORDER BY COALESCE(p.is_archived, FALSE),
               p.created_at DESC`,
    [ownerId],
  )
  return result.rows
}

export type WatchedProject = {
  projectId: string
  ownerId: string
  ownerEmail: string
  name: string
}

/**
 * Проекты, за которыми конвейер следит прямо сейчас.
 *
 * Три условия, и все три — решение разных людей: гейт ставит админ, паузу
 * пользователь, архив тоже пользователь. Наличие options.json здесь не
 * проверяется: это поход в объектное хранилище, и сканер делает его сам, уже
 * зная, что по проекту есть новые события.
 */
export async function listWatchedProjects(): Promise<WatchedProject[]> {
  const result = await query<WatchedProject>(
    `SELECT p.id AS "projectId",
            p.user_id AS "ownerId",
            u.email AS "ownerEmail",
            p.name
       FROM projects p
       JOIN users u ON u.id = p.user_id
      WHERE u.is_active
        AND COALESCE(u.automation_enabled, FALSE)
        AND COALESCE(p.is_paused, FALSE) = FALSE
        AND COALESCE(p.is_archived, FALSE) = FALSE`,
  )
  return result.rows
}
