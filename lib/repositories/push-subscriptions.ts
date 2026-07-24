import { randomUUID } from "node:crypto"
import { query } from "@/lib/db"

export type PushSubscriptionRecord = {
  id: string
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent: string
  createdAt: Date
}

const FIELDS = `
  id,
  user_id AS "userId",
  endpoint,
  p256dh,
  auth,
  user_agent AS "userAgent",
  created_at AS "createdAt"
`

/** One row per browser/device; re-subscribing the same endpoint just updates it. */
export async function upsertPushSubscription(input: {
  userId: string
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string
}): Promise<PushSubscriptionRecord> {
  const id = randomUUID()
  const result = await query<PushSubscriptionRecord>(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (endpoint) DO UPDATE
        SET user_id    = EXCLUDED.user_id,
            p256dh     = EXCLUDED.p256dh,
            auth       = EXCLUDED.auth,
            user_agent = EXCLUDED.user_agent
     RETURNING ${FIELDS}`,
    [id, input.userId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? ""],
  )
  return result.rows[0]
}

export async function listPushSubscriptionsByUserId(
  userId: string,
): Promise<PushSubscriptionRecord[]> {
  const result = await query<PushSubscriptionRecord>(
    `SELECT ${FIELDS} FROM push_subscriptions WHERE user_id = $1`,
    [userId],
  )
  return result.rows
}

export async function deletePushSubscriptionByEndpoint(
  endpoint: string,
): Promise<void> {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint])
}
