import { query } from "@/lib/db"

/**
 * История получателей диалога «Поделиться».
 *
 * Список принадлежит тому, кто приглашал, а не проекту: из «Проектов» и из
 * админских «Папок пользователей» открывается один и тот же диалог, и подсказки
 * в нём должны быть одни и те же.
 *
 * Записываем только удавшиеся приглашения: адрес с опечаткой в подсказках
 * бесполезен, а вычищать его пришлось бы руками.
 */

export type ShareContactRecord = {
  email: string
  fullName: string
  lastUsedAt: Date
}

/** Сколько адресов держим на человека: список — подсказка, а не адресная книга. */
const KEEP = 100

export async function listShareContacts(
  userId: string,
): Promise<ShareContactRecord[]> {
  const result = await query<ShareContactRecord>(
    `SELECT email,
            full_name AS "fullName",
            last_used_at AS "lastUsedAt"
       FROM share_contacts
      WHERE user_id = $1
      ORDER BY last_used_at DESC`,
    [userId],
  )
  return result.rows
}

/**
 * Запомнить получателя. Повтор поднимает запись наверх списка.
 *
 * Имя переписываем только непустым: у приглашённого «с нуля» его в момент
 * создания аккаунта может не быть, и пустая строка не должна затирать имя,
 * которое мы знали раньше.
 */
export async function rememberShareContact(input: {
  userId: string
  email: string
  fullName: string
}): Promise<void> {
  const email = input.email.trim().toLowerCase()
  if (!email) return
  await query(
    `INSERT INTO share_contacts (user_id, email, full_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, email)
     DO UPDATE SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''),
                                        share_contacts.full_name),
                   last_used_at = NOW()`,
    [input.userId, email, input.fullName.trim()],
  )
  // Обрезаем хвост здесь же: отдельная уборка ради подсказок не окупается, а
  // без неё список растёт без предела и его целиком грузит диалог.
  await query(
    `DELETE FROM share_contacts
      WHERE user_id = $1
        AND email NOT IN (
          SELECT email FROM share_contacts
           WHERE user_id = $1
           ORDER BY last_used_at DESC
           LIMIT $2
        )`,
    [input.userId, KEEP],
  )
}

export async function forgetShareContact(
  userId: string,
  email: string,
): Promise<boolean> {
  const result = await query(
    `DELETE FROM share_contacts WHERE user_id = $1 AND email = $2`,
    [userId, email.trim().toLowerCase()],
  )
  return (result.rowCount ?? 0) > 0
}
