/**
 * One-time migration: copy Google Drive project trees into Cloudflare R2
 * and seed Postgres `project_files`.
 *
 * Requires Drive OAuth env + R2/S3 env + DB in `.env`.
 *
 *   node scripts/migrate-drive-to-r2.mjs --dry-run
 *   node scripts/migrate-drive-to-r2.mjs
 *
 * Layout written to R2:
 *   {prefix}/projects/{projectId}/project-meta.json
 *   {prefix}/projects/{projectId}/options/...
 *   {prefix}/projects/{projectId}/{folderPath}/{uuid}-{safeName}
 */
import "dotenv/config"
import { createWriteStream } from "node:fs"
import { randomUUID } from "node:crypto"
import pg from "pg"
import { google } from "googleapis"
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { readConnectionConfig } from "./pg-connection.mjs"

const FOLDER_MIME = "application/vnd.google-apps.folder"
const OPTIONS_FOLDER = "options"
const META_FILE = "project-meta.json"
const DRY_RUN = process.argv.includes("--dry-run")

function requireEnv(name) {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function getPrefix() {
  return (process.env.AWS_S3_PREFIX || "innohub").replace(/^\/+|\/+$/g, "")
}

function buildKey(relative) {
  const rel = relative.replace(/^\/+/, "").replace(/\.\./g, "_")
  return `${getPrefix()}/${rel}`
}

function safeBaseFileName(name) {
  return String(name || "file")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "file"
}

function createDrive() {
  const rootFolderId =
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID?.trim() ||
    process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID?.trim()
  const clientId =
    process.env.GOOGLE_DRIVE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret =
    process.env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim()
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim()

  if (!rootFolderId || !clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Drive OAuth incomplete. Need GOOGLE_DRIVE_ROOT_FOLDER_ID, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN.",
    )
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
  oauth2.setCredentials({ refresh_token: refreshToken })
  return {
    drive: google.drive({ version: "v3", auth: oauth2 }),
    rootFolderId,
  }
}

function createS3() {
  const bucket = requireEnv("AWS_S3_BUCKET")
  const accessKeyId =
    process.env.S3_KEY_ID ||
    process.env.AWS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.S3_SECRET_KEY ||
    process.env.AWS_SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3_KEY_ID / S3_SECRET_KEY (or AWS_* equivalents).")
  }
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
  const region = process.env.AWS_REGION || "us-east-1"
  const forcePathStyle =
    process.env.AWS_S3_FORCE_PATH_STYLE === undefined ||
    process.env.AWS_S3_FORCE_PATH_STYLE === ""
      ? Boolean(endpoint)
      : process.env.AWS_S3_FORCE_PATH_STYLE === "1" ||
        process.env.AWS_S3_FORCE_PATH_STYLE?.toLowerCase() === "true"

  return {
    bucket,
    client: new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  }
}

async function listChildren(drive, parentId) {
  const files = []
  let pageToken
  do {
    const res = await drive.files.list({
      q: `'${parentId}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, size, createdTime, modifiedTime)",
      pageSize: 1000,
      pageToken,
      spaces: "drive",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    for (const f of res.data.files ?? []) {
      if (f.id && f.name) files.push(f)
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return files
}

async function headSize(s3, key) {
  try {
    const res = await s3.client.send(
      new HeadObjectCommand({ Bucket: s3.bucket, Key: key }),
    )
    return Number(res.ContentLength ?? NaN)
  } catch {
    return null
  }
}

async function putBuffer(s3, key, body, contentType, dryRun) {
  const size = Buffer.isBuffer(body)
    ? body.length
    : typeof body === "string"
      ? Buffer.byteLength(body)
      : null
  const existing = await headSize(s3, key)
  if (existing != null && size != null && existing === size) {
    return { skipped: true, key, size: existing }
  }
  if (dryRun) {
    return { skipped: false, dryRun: true, key, size }
  }
  await s3.client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
    }),
  )
  return { skipped: false, key, size }
}

async function downloadDriveMedia(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  )
  return Buffer.from(res.data)
}

async function ensureDbFolder(db, projectId, folderPath, name) {
  const existing = await db.query(
    `SELECT id FROM project_files
      WHERE project_id = $1 AND folder_path = $2 AND name = $3`,
    [projectId, folderPath, name],
  )
  if (existing.rows[0]) return existing.rows[0].id
  if (DRY_RUN) return `dry-run-${randomUUID()}`
  const id = randomUUID()
  await db.query(
    `INSERT INTO project_files (
        id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
     ) VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '')
     ON CONFLICT (project_id, folder_path, name) DO NOTHING`,
    [id, projectId, folderPath, name],
  )
  return id
}

async function ensureDbFile(db, input) {
  const existing = await db.query(
    `SELECT id, s3_key AS "s3Key" FROM project_files
      WHERE project_id = $1 AND folder_path = $2 AND name = $3`,
    [input.projectId, input.folderPath, input.name],
  )
  if (existing.rows[0]) return existing.rows[0]
  if (DRY_RUN) return { id: `dry-run-${randomUUID()}`, s3Key: input.s3Key }
  const id = randomUUID()
  await db.query(
    `INSERT INTO project_files (
        id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
     ) VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7)
     ON CONFLICT (project_id, folder_path, name) DO UPDATE
       SET s3_key = EXCLUDED.s3_key,
           size_bytes = EXCLUDED.size_bytes,
           content_type = EXCLUDED.content_type
     RETURNING id`,
    [
      id,
      input.projectId,
      input.folderPath,
      input.name,
      input.s3Key,
      input.sizeBytes,
      input.contentType,
    ],
  )
  return { id, s3Key: input.s3Key }
}

async function migrateFolder(ctx, projectId, driveFolderId, folderPath) {
  const children = await listChildren(ctx.drive, driveFolderId)
  for (const child of children) {
    const isFolder = child.mimeType === FOLDER_MIME
    const name = child.name

    if (folderPath === "" && name.toLowerCase() === OPTIONS_FOLDER) {
      await migrateOptions(ctx, projectId, child.id)
      continue
    }
    if (folderPath === "" && name.toLowerCase() === META_FILE.toLowerCase()) {
      const buf = await downloadDriveMedia(ctx.drive, child.id)
      const key = buildKey(`projects/${projectId}/${META_FILE}`)
      const result = await putBuffer(
        ctx.s3,
        key,
        buf,
        "application/json",
        DRY_RUN,
      )
      ctx.log({ type: "meta", projectId, ...result })
      ctx.stats.files += 1
      continue
    }

    if (isFolder) {
      await ensureDbFolder(ctx.db, projectId, folderPath, name)
      ctx.stats.folders += 1
      const nextPath = folderPath ? `${folderPath}/${name}` : name
      await migrateFolder(ctx, projectId, child.id, nextPath)
      continue
    }

    // Skip Google Docs native types that cannot be downloaded as binary
    if (String(child.mimeType || "").startsWith("application/vnd.google-apps.")) {
      ctx.log({
        type: "skip-google-doc",
        projectId,
        name,
        mimeType: child.mimeType,
      })
      ctx.stats.skipped += 1
      continue
    }

    const sizeBytes = child.size ? Number.parseInt(String(child.size), 10) : 0
    const safeName = `${randomUUID()}-${safeBaseFileName(name)}`
    const relative = folderPath
      ? `projects/${projectId}/${folderPath}/${safeName}`
      : `projects/${projectId}/${safeName}`
    const key = buildKey(relative)

    // Idempotent by logical name: reuse existing s3_key when present
    const existing = await ctx.db.query(
      `SELECT s3_key AS "s3Key", size_bytes::float8 AS "sizeBytes"
         FROM project_files
        WHERE project_id = $1 AND folder_path = $2 AND name = $3 AND is_folder = FALSE`,
      [projectId, folderPath, name],
    )
    let targetKey = existing.rows[0]?.s3Key || key
    if (existing.rows[0]?.s3Key) {
      const head = await headSize(ctx.s3, existing.rows[0].s3Key)
      if (head != null && sizeBytes && head === sizeBytes) {
        ctx.log({
          type: "file-skip",
          projectId,
          folderPath,
          name,
          key: existing.rows[0].s3Key,
        })
        ctx.stats.skipped += 1
        continue
      }
      targetKey = existing.rows[0].s3Key
    }

    const buf = await downloadDriveMedia(ctx.drive, child.id)
    const result = await putBuffer(
      ctx.s3,
      targetKey,
      buf,
      child.mimeType || "application/octet-stream",
      DRY_RUN,
    )
    if (!DRY_RUN) {
      await ensureDbFile(ctx.db, {
        projectId,
        folderPath,
        name,
        s3Key: targetKey,
        sizeBytes: buf.length,
        contentType: child.mimeType || "application/octet-stream",
      })
    }
    ctx.log({ type: "file", projectId, folderPath, name, ...result })
    ctx.stats.files += 1
  }
}

async function migrateOptions(ctx, projectId, optionsFolderId) {
  const children = await listChildren(ctx.drive, optionsFolderId)
  for (const child of children) {
    if (child.mimeType === FOLDER_MIME) continue
    if (String(child.mimeType || "").startsWith("application/vnd.google-apps.")) {
      continue
    }
    const buf = await downloadDriveMedia(ctx.drive, child.id)
    const key = buildKey(
      `projects/${projectId}/${OPTIONS_FOLDER}/${safeBaseFileName(child.name)}`,
    )
    const result = await putBuffer(
      ctx.s3,
      key,
      buf,
      child.mimeType || "application/json",
      DRY_RUN,
    )
    ctx.log({ type: "options", projectId, name: child.name, ...result })
    ctx.stats.files += 1
  }
}

async function resolveProject(db, driveFolderId, folderName, userId) {
  const byId = await db.query(
    `SELECT id, name, user_id AS "userId", drive_folder_id AS "driveFolderId"
       FROM projects WHERE drive_folder_id = $1`,
    [driveFolderId],
  )
  if (byId.rows[0]) return byId.rows[0]

  if (userId) {
    const byName = await db.query(
      `SELECT id, name, user_id AS "userId", drive_folder_id AS "driveFolderId"
         FROM projects
        WHERE user_id = $1 AND lower(name) = lower($2)
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, folderName],
    )
    if (byName.rows[0]) return byName.rows[0]
  }

  return null
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN ===" : "=== MIGRATE Drive → R2 ===")

  const { drive, rootFolderId } = createDrive()
  const s3 = createS3()
  const db = new pg.Pool(readConnectionConfig())

  const logPath = `migrated-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
  const logStream = createWriteStream(logPath, { flags: "a" })
  const stats = { users: 0, projects: 0, files: 0, folders: 0, skipped: 0, unmatched: 0 }

  const ctx = {
    drive,
    s3,
    db,
    stats,
    log(entry) {
      logStream.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
    },
  }

  try {
    const userFolders = (await listChildren(drive, rootFolderId)).filter(
      (f) => f.mimeType === FOLDER_MIME,
    )

    for (const userFolder of userFolders) {
      const email = userFolder.name.toLowerCase()
      const userRes = await db.query(
        `SELECT id, email, drive_folder_id AS "driveFolderId"
           FROM users WHERE lower(email) = $1`,
        [email],
      )
      let user = userRes.rows[0]
      if (!user) {
        const byDrive = await db.query(
          `SELECT id, email, drive_folder_id AS "driveFolderId"
             FROM users WHERE drive_folder_id = $1`,
          [userFolder.id],
        )
        user = byDrive.rows[0]
      }
      if (!user) {
        console.warn(`[skip user folder] no DB user for ${email}`)
        ctx.log({ type: "unmatched-user", email, driveFolderId: userFolder.id })
        stats.unmatched += 1
        continue
      }

      stats.users += 1
      console.log(`User ${user.email}`)

      const projectFolders = (await listChildren(drive, userFolder.id)).filter(
        (f) => f.mimeType === FOLDER_MIME,
      )

      for (const projectFolder of projectFolders) {
        const project = await resolveProject(
          db,
          projectFolder.id,
          projectFolder.name,
          user.id,
        )
        if (!project) {
          console.warn(
            `  [skip project] unmatched Drive folder "${projectFolder.name}" (${projectFolder.id})`,
          )
          ctx.log({
            type: "unmatched-project",
            email: user.email,
            name: projectFolder.name,
            driveFolderId: projectFolder.id,
          })
          stats.unmatched += 1
          continue
        }

        stats.projects += 1
        console.log(`  Project ${project.name} (${project.id})`)

        // Ensure default IN/OUT folders exist in DB
        await ensureDbFolder(db, project.id, "", "IN")
        await ensureDbFolder(db, project.id, "", "OUT")

        await migrateFolder(ctx, project.id, projectFolder.id, "")
      }
    }

    console.log("\nSummary:", stats)
    console.log(`Log: ${logPath}`)
  } finally {
    logStream.end()
    await db.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
