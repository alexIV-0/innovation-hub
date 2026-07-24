import webpush from "web-push"
import {
  deletePushSubscriptionByEndpoint,
  listPushSubscriptionsByUserId,
} from "@/lib/repositories/push-subscriptions"

export function isPushConfigured(): boolean {
  return !!(
    process.env.VAPID_PUBLIC_KEY?.trim() &&
    process.env.VAPID_PRIVATE_KEY?.trim() &&
    process.env.VAPID_SUBJECT?.trim()
  )
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

let configured = false
function ensureConfigured() {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push is not configured (missing VAPID_* env vars).")
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

export type PushPayload = {
  title: string
  body: string
  /** Path (e.g. "/account/projects/123/chat") opened on notification click. */
  url: string
}

/**
 * Sends a push notification to every browser/device the user has subscribed
 * from. Best-effort: a subscription that the push service reports as gone
 * (404/410 — e.g. the user cleared browsing data or uninstalled) is deleted;
 * any other per-subscription failure is logged and otherwise ignored so one
 * dead device never blocks notifying the user's other devices.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!isPushConfigured()) return
  ensureConfigured()

  const subscriptions = await listPushSubscriptionsByUserId(userId)
  if (subscriptions.length === 0) return

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify(payload),
        )
      } catch (error) {
        const statusCode =
          error && typeof error === "object" && "statusCode" in error
            ? (error as { statusCode?: number }).statusCode
            : undefined
        if (statusCode === 404 || statusCode === 410) {
          await deletePushSubscriptionByEndpoint(sub.endpoint).catch(() => {})
        } else {
          console.error("[push] sendNotification failed", {
            userId,
            statusCode,
            error,
          })
        }
      }
    }),
  )
}
