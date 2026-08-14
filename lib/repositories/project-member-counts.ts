import { query } from "@/lib/db"

/**
 * Сколько людей видят проект помимо владельца.
 *
 * Таблица `project_members` приходит с функцией расшаривания из ветки
 * `upstream/main` (миграция `2026-08-13-storage-jobs-sharing.sql`, применена к
 * общей базе). В `db/schema.sql` этой ветки её объявления НЕТ намеренно: схема
 * принадлежит той миграции, и второе объявление здесь стало бы конфликтом при
 * слиянии. По той же причине счётчик лежит в отдельном файле, а не в
 * `lib/repositories/project-members.ts` — тот файл в upstream уже занят своим
 * содержимым.
 *
 * Владелец исключается явно (`pm.user_id <> p.user_id`), хотя текущий поток
 * приглашений его в участники и не пишет: число должно означать «скольким
 * расшарили», и оставаться верным, если владелец однажды получит свою строку.
 */
export async function countProjectMembers(
  projectIds: string[],
): Promise<Record<string, number>> {
  if (projectIds.length === 0) return {}

  const result = await query<{ projectId: string; n: number }>(
    `SELECT pm.project_id AS "projectId",
            COUNT(*)::int AS n
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
      WHERE pm.project_id = ANY($1::text[])
        AND pm.user_id <> p.user_id
      GROUP BY pm.project_id`,
    [projectIds],
  )

  const counts: Record<string, number> = {}
  for (const row of result.rows) counts[row.projectId] = row.n
  return counts
}
