/**
 * Registers the `chat_message-created` webhook subscription with YouGile,
 * pointing at this app's public webhook receiver. Run once manually (and
 * again if APP_PUBLIC_URL or YOUGILE_WEBHOOK_SECRET ever change).
 *
 * Prerequisites:
 *   YOUGILE_API_KEY, YOUGILE_WEBHOOK_SECRET, APP_PUBLIC_URL in .env
 *
 * Usage:
 *   node scripts/yougile-setup-webhook.mjs
 *   node scripts/yougile-setup-webhook.mjs --dry-run
 */

import "dotenv/config"

const YOUGILE_API_BASE = "https://yougile.com/api-v2"
const EVENT = "chat_message-created"
const DRY_RUN = process.argv.includes("--dry-run")

function readConfig() {
  const apiKey = process.env.YOUGILE_API_KEY?.trim()
  const webhookSecret = process.env.YOUGILE_WEBHOOK_SECRET?.trim()
  const publicUrl = process.env.APP_PUBLIC_URL?.trim()

  if (!apiKey) throw new Error("YOUGILE_API_KEY is not set in .env")
  if (!webhookSecret) throw new Error("YOUGILE_WEBHOOK_SECRET is not set in .env")
  if (!publicUrl) throw new Error("APP_PUBLIC_URL is not set in .env")

  return { apiKey, webhookSecret, publicUrl }
}

async function main() {
  const { apiKey, webhookSecret, publicUrl } = readConfig()
  const url = `${publicUrl.replace(/\/$/, "")}/api/webhooks/yougile?token=${encodeURIComponent(webhookSecret)}`

  console.log(`Event:    ${EVENT}`)
  console.log(`Callback: ${url}`)

  if (DRY_RUN) {
    console.log("\n[dry-run] Not calling YouGile API.")
    return
  }

  const response = await fetch(`${YOUGILE_API_BASE}/webhooks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, event: EVENT }),
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    console.error(`\nYouGile API error (HTTP ${response.status}):`, payload)
    process.exit(1)
  }

  console.log("\nWebhook subscription created:", payload)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
