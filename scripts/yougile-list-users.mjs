/**
 * Prints YouGile company users (id / email / name) so you can pick which
 * ones to put into YOUGILE_BOT_USER_ID / YOUGILE_CHAT_MEMBER_IDS in .env.
 *
 * Prerequisites:
 *   YOUGILE_API_KEY in .env
 *
 * Usage:
 *   node scripts/yougile-list-users.mjs
 */

import "dotenv/config"

const YOUGILE_API_BASE = "https://yougile.com/api-v2"

function requireApiKey() {
  const apiKey = process.env.YOUGILE_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("YOUGILE_API_KEY is not set in .env")
  }
  return apiKey
}

async function main() {
  const apiKey = requireApiKey()

  const response = await fetch(`${YOUGILE_API_BASE}/users`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    console.error(`YouGile API error (HTTP ${response.status}):`, payload)
    process.exit(1)
  }

  const users = Array.isArray(payload) ? payload : payload?.content ?? []

  if (users.length === 0) {
    console.log("No users returned. Raw response:", payload)
    return
  }

  console.log(`Found ${users.length} user(s):\n`)
  for (const user of users) {
    console.log(
      `id=${user.id}  email=${user.email ?? "-"}  name=${user.realName ?? user.name ?? "-"}`,
    )
  }
  console.log(
    "\nPick one id for YOUGILE_BOT_USER_ID (the API key owner is usually the " +
      "right choice) and a comma-separated list for YOUGILE_CHAT_MEMBER_IDS.",
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
