/**
 * Seed missing project-meta.json objects into Cloudflare R2 for every
 * project row in Postgres. Refuses Timeweb endpoints.
 *
 *   node scripts/backfill-projects-to-r2.mjs --dry-run
 *   node scripts/backfill-projects-to-r2.mjs
 */
import "dotenv/config"
import pg from "pg"
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { readConnectionConfig } from "./pg-connection.mjs"

const DRY_RUN = process.argv.includes("--dry-run")
const FORCE = process.argv.includes("--force")

function requireEnv(name) {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

function getPrefix() {
  return (process.env.AWS_S3_PREFIX || "innohub").replace(/^\/+|\/+$/g, "")
}

function createS3() {
  const bucket = requireEnv("AWS_S3_BUCKET")
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
  if (!endpoint) throw new Error("Missing AWS_ENDPOINT_URL (R2)")
  if (/twcstorage\.ru/i.test(endpoint)) {
    throw new Error(
      "AWS_ENDPOINT_URL points at Timeweb. Refusing to write. Use R2.",
    )
  }
  if (!/r2\.cloudflarestorage\.com/i.test(endpoint)) {
    throw new Error(
      `AWS_ENDPOINT_URL is not Cloudflare R2 (${endpoint}). Refusing.`,
    )
  }

  const accessKeyId =
    process.env.S3_KEY_ID ||
    process.env.AWS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.S3_SECRET_KEY ||
    process.env.AWS_SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3_KEY_ID / S3_SECRET_KEY")
  }

  return {
    bucket,
    endpoint,
    client: new S3Client({
      region: process.env.AWS_REGION?.trim() || "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  }
}

async function objectExists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return true
  } catch {
    return false
  }
}

const { bucket, endpoint, client } = createS3()
const dbCfg = readConnectionConfig()
const pool = new pg.Pool({ ...dbCfg, ssl: false, max: 2 })

console.log({
  dryRun: DRY_RUN,
  force: FORCE,
  endpoint,
  bucket,
  prefix: getPrefix(),
  db: `${dbCfg.host}/${dbCfg.database}`,
})

const { rows } = await pool.query(`
  SELECT
    p.id,
    p.name,
    COALESCE(p.description, '') AS description,
    p.created_at AS "createdAt",
    u.email AS "ownerEmail"
  FROM projects p
  LEFT JOIN users u ON u.id = p.user_id
  ORDER BY p.created_at ASC
`)

console.log(`projects in DB: ${rows.length}`)

let wrote = 0
let skipped = 0
let failed = 0

for (const row of rows) {
  const key = `${getPrefix()}/projects/${row.id}/project-meta.json`
  const exists = FORCE ? false : await objectExists(client, bucket, key)
  if (exists) {
    skipped += 1
    console.log(`skip ${row.id} (${row.name}) — already in R2`)
    continue
  }

  const payload = {
    name: row.name,
    description: row.description,
    ownerEmail: row.ownerEmail || "",
    createdAt: new Date(row.createdAt).toISOString(),
  }
  const body = JSON.stringify(payload, null, 2)

  if (DRY_RUN) {
    console.log(`dry-run would put ${key}`)
    wrote += 1
    continue
  }

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json",
      }),
    )
    wrote += 1
    console.log(`ok ${key}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL ${key}`, err?.message || err)
  }
}

await pool.end()
console.log({ wrote, skipped, failed })
if (failed > 0) process.exit(1)
