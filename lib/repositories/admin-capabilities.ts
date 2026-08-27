import { query } from "@/lib/db"
import {
  isAdminCapability,
  type AdminCapability,
} from "@/lib/admin-capabilities"

/**
 * Теги читаются отдельным запросом, а не джойном в PUBLIC_USER_FIELDS.
 *
 * Причина практическая: те же поля стоят в RETURNING у пяти мутаций, и тащить
 * туда подзапрос значило бы менять пять рабочих операций ради одного чтения.
 * Запрос идёт по первичному ключу таблицы, а getCurrentUser обёрнут в
 * React.cache — за рендер платится один раз.
 */
export async function listCapabilitiesFor(
  userId: string,
): Promise<AdminCapability[]> {
  const result = await query<{ capability: string }>(
    `SELECT capability FROM admin_capabilities WHERE user_id = $1`,
    [userId],
  )
  // Фильтруем на выходе: в базе могла остаться строка от тега, который из кода
  // убрали. Неизвестное имя не должно ничего открывать и не должно всплывать в
  // интерфейсе галочкой без подписи.
  return result.rows
    .map((row) => row.capability)
    .filter(isAdminCapability)
}

export type CapabilityGrant = {
  capability: AdminCapability
  grantedBy: string | null
  grantedByEmail: string | null
  grantedAt: Date
}

/** Что выдано и кем — для экрана выдачи и разбирательств. */
export async function listGrantsFor(
  userId: string,
): Promise<CapabilityGrant[]> {
  const result = await query<{
    capability: string
    grantedBy: string | null
    grantedByEmail: string | null
    grantedAt: Date
  }>(
    `SELECT ac.capability,
            ac.granted_by AS "grantedBy",
            u.email       AS "grantedByEmail",
            ac.granted_at AS "grantedAt"
       FROM admin_capabilities ac
       LEFT JOIN users u ON u.id = ac.granted_by
      WHERE ac.user_id = $1
      ORDER BY ac.capability ASC`,
    [userId],
  )
  return result.rows.filter((row) => isAdminCapability(row.capability)) as CapabilityGrant[]
}

export async function listCapabilitiesForMany(
  userIds: string[],
): Promise<Map<string, AdminCapability[]>> {
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0) return new Map()

  const result = await query<{ userId: string; capability: string }>(
    `SELECT user_id AS "userId", capability
       FROM admin_capabilities
      WHERE user_id = ANY($1::text[])`,
    [unique],
  )

  const byUser = new Map<string, AdminCapability[]>()
  for (const row of result.rows) {
    if (!isAdminCapability(row.capability)) continue
    const list = byUser.get(row.userId)
    if (list) list.push(row.capability)
    else byUser.set(row.userId, [row.capability])
  }
  return byUser
}

/**
 * Заменить набор целиком — ровно то, что делает экран с галочками.
 *
 * Одной транзакцией и через diff, а не «снести всё и вставить заново»: иначе
 * granted_by и granted_at сбрасывались бы у тегов, которых человек не касался, и
 * ответ на вопрос «кто ему это выдал» терялся бы при каждом сохранении.
 */
export async function setCapabilities(input: {
  userId: string
  capabilities: readonly AdminCapability[]
  grantedBy: string
}): Promise<{ added: AdminCapability[]; removed: AdminCapability[] }> {
  const current = await listCapabilitiesFor(input.userId)
  const next = [...new Set(input.capabilities)]

  const added = next.filter((c) => !current.includes(c))
  const removed = current.filter((c) => !next.includes(c))

  if (added.length > 0) {
    await query(
      `INSERT INTO admin_capabilities (user_id, capability, granted_by)
       SELECT $1, capability, $3 FROM UNNEST($2::text[]) AS capability
       ON CONFLICT (user_id, capability) DO NOTHING`,
      [input.userId, added, input.grantedBy],
    )
  }
  if (removed.length > 0) {
    await query(
      `DELETE FROM admin_capabilities
        WHERE user_id = $1 AND capability = ANY($2::text[])`,
      [input.userId, removed],
    )
  }

  return { added, removed }
}

/** Понижение до USER: тегов у не-админа быть не должно. */
export async function clearCapabilities(userId: string): Promise<void> {
  await query(`DELETE FROM admin_capabilities WHERE user_id = $1`, [userId])
}
