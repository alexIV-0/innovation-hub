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

async function apiGet(apiKey, path) {
  const response = await fetch(`${YOUGILE_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`YouGile API error (HTTP ${response.status}): ${JSON.stringify(payload)}`)
  }
  return payload
}

async function main() {
  const apiKey = requireApiKey()

  // /users/me identifies the account that owns YOUGILE_API_KEY — exactly
  // the account that should become YOUGILE_BOT_USER_ID, since messages
  // sent via the API always appear as sent by this user.
  const me = await apiGet(apiKey, "/users/me").catch((error) => {
    console.warn("Could not resolve the API key owner via /users/me:", error.message)
    return null
  })

  const payload = await apiGet(apiKey, "/users")
  const users = Array.isArray(payload) ? payload : payload?.content ?? []

  if (users.length === 0) {
    console.log("No users returned. Raw response:", payload)
    return
  }

  console.log(`Found ${users.length} user(s):\n`)
  for (const user of users) {
    const isKeyOwner = me?.id && user.id === me.id
    console.log(
      `id=${user.id}  email=${user.email ?? "-"}  name=${user.realName ?? user.name ?? "-"}` +
        (isKeyOwner ? "  <-- owns YOUGILE_API_KEY (use as YOUGILE_BOT_USER_ID)" : ""),
    )
  }
  console.log(
    "\nPick a comma-separated list of the remaining ids for YOUGILE_CHAT_MEMBER_IDS " +
      "(team members to add to every new project chat).",
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
