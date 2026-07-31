/**
 * One-time helper to obtain a Google Drive OAuth refresh token.
 *
 * Use this when Organization Policy blocks service-account keys
 * (`iam.disableServiceAccountKeyCreation`).
 *
 * Prerequisites:
 *  1. Google Cloud Console → APIs & Services → enable "Google Drive API"
 *  2. Credentials → Create OAuth client ID → type "Desktop app"
 *     (or Web app with redirect http://127.0.0.1:53682/oauth2callback)
 *  3. Put client id/secret in .env as GOOGLE_DRIVE_CLIENT_ID / SECRET
 *     (or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 *  4. Create a Drive folder owned by the Google account you will authorize
 *     and copy its id into GOOGLE_DRIVE_ROOT_FOLDER_ID
 *
 * Run:
 *   node scripts/google-drive-oauth.mjs
 *
 * Then paste the printed GOOGLE_DRIVE_REFRESH_TOKEN into .env
 */

import "dotenv/config"
import http from "node:http"
import { URL } from "node:url"
import { google } from "googleapis"

const PORT = Number(process.env.GOOGLE_DRIVE_OAUTH_PORT || 53682)
const REDIRECT_URI =
  process.env.GOOGLE_DRIVE_OAUTH_REDIRECT_URI?.trim() ||
  `http://127.0.0.1:${PORT}/oauth2callback`
const SCOPES = ["https://www.googleapis.com/auth/drive"]

const clientId =
  process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() ||
  process.env.GOOGLE_CLIENT_ID?.trim()
const clientSecret =
  process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ||
  process.env.GOOGLE_CLIENT_SECRET?.trim()

if (!clientId || !clientSecret) {
  console.error(
    "Missing OAuth client credentials.\n" +
      "Set GOOGLE_DRIVE_CLIENT_ID + GOOGLE_DRIVE_CLIENT_SECRET\n" +
      "(or GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET) in .env, then re-run.",
  )
  process.exit(1)
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI)

const authorizeUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
})

console.log("\nGoogle Drive OAuth setup")
console.log("========================")
console.log(`Redirect URI (must match Cloud Console): ${REDIRECT_URI}`)
console.log("\n1. Open this URL in a browser and sign in as the Drive owner:\n")
console.log(authorizeUrl)
console.log("\n2. Approve Drive access. This script will capture the code.\n")

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url?.startsWith("/oauth2callback")) {
      res.writeHead(404).end("Not found")
      return
    }

    const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
    const err = url.searchParams.get("error")
    if (err) {
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(`<h1>OAuth error</h1><pre>${err}</pre>`)
      console.error("OAuth error:", err)
      server.close()
      process.exit(1)
    }

    const code = url.searchParams.get("code")
    if (!code) {
      res.writeHead(400).end("Missing code")
      return
    }

    const { tokens } = await oauth2.getToken(code)
    const refresh = tokens.refresh_token

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    res.end(
      "<h1>Success</h1><p>You can close this tab and return to the terminal.</p>",
    )

    console.log("\nAdd these to your .env:\n")
    console.log(`GOOGLE_DRIVE_CLIENT_ID=${clientId}`)
    console.log(`GOOGLE_DRIVE_CLIENT_SECRET=${clientSecret}`)
    if (refresh) {
      console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${refresh}`)
    } else {
      console.log(
        "# WARNING: Google did not return a refresh_token.\n" +
          "# Revoke prior access at https://myaccount.google.com/permissions\n" +
          "# then re-run with prompt=consent (this script already sets it).",
      )
    }
    console.log(
      "\nAlso set GOOGLE_DRIVE_ROOT_FOLDER_ID=<your folder id>\n" +
        "You can remove GOOGLE_DRIVE_CLIENT_EMAIL / GOOGLE_DRIVE_PRIVATE_KEY.\n",
    )

    server.close()
    process.exit(refresh ? 0 : 1)
  } catch (error) {
    console.error(error)
    res.writeHead(500).end("Token exchange failed — see terminal.")
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Listening on ${REDIRECT_URI} …`)
})
