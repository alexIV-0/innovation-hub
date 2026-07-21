/**
 * Backfill Google Drive folders for existing USER accounts.
 *
 * Creates a folder named by each user's email under GOOGLE_DRIVE_ROOT_FOLDER_ID
 * (on the platform Drive account — clients never connect their own Drive),
 * then stores drive_folder_id on the users row.
 *
 * Prerequisites:
 *   GOOGLE_DRIVE_CLIENT_ID / SECRET / REFRESH_TOKEN / ROOT_FOLDER_ID in .env
 *   (or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
 *   DB connection via PG* or DB_CONNECTION_STRING
 *
 * Usage:
 *   node scripts/drive-provision-users.mjs
 *   node scripts/drive-provision-users.mjs --dry-run
 *   node scripts/drive-provision-users.mjs --force   # refresh folder id even if set
 */

import "dotenv/config"
import { google } from "googleapis"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

const DRY_RUN = process.argv.includes("--dry-run")
const FORCE = process.argv.includes("--force")
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive"

function readDriveAuth() {
  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()
  const rootFolderId =
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ||
    process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim()
  const sharedDriveId = process.env.GOOGLE_DRIVE_SHARED_DRIVE_ID?.trim()

  if (!clientId || !clientSecret || !refreshToken || !rootFolderId) {
    throw new Error(
      "Missing Drive OAuth env. Need GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID.",
    )
  }

  return { clientId, clientSecret, refreshToken, rootFolderId, sharedDriveId }
}

function sanitizeDriveName(raw, fallback = "untitled") {
  const cleaned = String(raw)
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
  return cleaned || fallback
}

function driveFlags(sharedDriveId) {
  return {
    supportsAllDrives: true,
    ...(sharedDriveId
      ? { driveId: sharedDriveId, includeItemsFromAllDrives: true }
      : {}),
  }
}

async function findChildFolder(drive, sharedDriveId, parentId, name) {
  const escaped = name.replace(/'/g, "\\'")
  const response = await drive.files.list({
    ...driveFlags(sharedDriveId),
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id, name)",
    pageSize: 1,
    spaces: "drive",
  })
  return response.data.files?.[0]?.id ?? null
}

async function ensureEmailFolder(drive, sharedDriveId, rootFolderId, email) {
  const name = sanitizeDriveName(email.toLowerCase())
  const existing = await findChildFolder(
    drive,
    sharedDriveId,
    rootFolderId,
    name,
  )
  if (existing) return { folderId: existing, created: false }

  const response = await drive.files.create({
    ...driveFlags(sharedDriveId),
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    },
    fields: "id",
  })
  const folderId = response.data.id
  if (!folderId) throw new Error(`Drive did not return folder id for ${email}`)
  return { folderId, created: true }
}

async function main() {
  const authCfg = readDriveAuth()
  let dbConfig
  try {
    dbConfig = readConnectionConfig()
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }

  const oauth2 = new google.auth.OAuth2(authCfg.clientId, authCfg.clientSecret)
  oauth2.setCredentials({ refresh_token: authCfg.refreshToken })
  const drive = google.drive({ version: "v3", auth: oauth2 })

  const client = new Client({
    user: dbConfig.user,
    password: dbConfig.password,
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    ssl: resolvePgSsl(),
  })

  await client.connect()
  console.log("Connected to PostgreSQL.")

  // Idempotent in case schema.sql wasn't applied yet on this DB.
  await client.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS drive_folder_id TEXT`,
  )

  const { rows: users } = await client.query(
    `SELECT id, email, full_name AS "fullName", drive_folder_id AS "driveFolderId"
       FROM users
      WHERE role = 'USER'
      ORDER BY created_at ASC`,
  )

  console.log(
    `\nFound ${users.length} USER account(s).` +
      (DRY_RUN ? " [dry-run]" : "") +
      (FORCE ? " [force]" : "") +
      `\nRoot folder: ${authCfg.rootFolderId}\n`,
  )

  let created = 0
  let linked = 0
  let skipped = 0
  let failed = 0

  for (const user of users) {
    const email = String(user.email).toLowerCase()

    if (user.driveFolderId && !FORCE) {
      console.log(`skip  ${email}  (already has drive_folder_id)`)
      skipped += 1
      continue
    }

    if (DRY_RUN) {
      console.log(
        `would ${user.driveFolderId ? "refresh" : "create"}  ${email}`,
      )
      continue
    }

    try {
      const { folderId, created: wasCreated } = await ensureEmailFolder(
        drive,
        authCfg.sharedDriveId,
        authCfg.rootFolderId,
        email,
      )

      await client.query(
        `UPDATE users
            SET drive_folder_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [user.id, folderId],
      )

      if (wasCreated) {
        console.log(`create ${email}  →  ${folderId}`)
        created += 1
      } else {
        console.log(`link   ${email}  →  ${folderId}`)
        linked += 1
      }
    } catch (error) {
      failed += 1
      console.error(
        `fail   ${email}  ${error instanceof Error ? error.message : error}`,
      )
    }
  }

  await client.end()

  console.log(
    `\nDone. created=${created} linked=${linked} skipped=${skipped} failed=${failed}`,
  )
  if (failed > 0) process.exit(1)
}

main().catch(async (error) => {
  console.error(error)
  process.exit(1)
})
