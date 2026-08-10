/**
 * Copies legacy Timeweb and old R2 keys into the current R2 layout:
 *
 *   projects/{userId}/{projectId}/...
 *
 * Default mode is read-only. Use --apply only after reviewing its report.
 * The script never deletes source objects.
 *
 * Required destination env: AWS_ENDPOINT_URL, AWS_S3_BUCKET, S3_KEY_ID,
 * S3_SECRET_KEY. Optional Timeweb source env: TW_S3_URL, TW_S3_BUCKET,
 * TW_S3_ACCESS_KEY, TW_S3_SECRET_KEY.
 *
 *   node scripts/migrate-object-storage-to-r2.mjs
 *   node scripts/migrate-object-storage-to-r2.mjs --apply
 *   node scripts/migrate-object-storage-to-r2.mjs --apply --delete-r2-legacy
 *
 * `--delete-r2-legacy` only removes verified duplicate objects from the R2
 * destination after their keys have moved. Timeweb objects are never deleted.
 */
import "dotenv/config"
import pg from "pg"
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { Upload } from "@aws-sdk/lib-storage"
import { readConnectionConfig } from "./pg-connection.mjs"

const APPLY = process.argv.includes("--apply")
const DELETE_LEGACY_R2 = process.argv.includes("--delete-r2-legacy")
const R2_HOST_RE = /r2\.cloudflarestorage\.com/i
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function makeClient({ endpoint, accessKeyId, secretAccessKey, region = "auto" }) {
  return new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })
}

function r2Target() {
  const endpoint = required("AWS_ENDPOINT_URL")
  if (!R2_HOST_RE.test(endpoint)) {
    throw new Error(`AWS_ENDPOINT_URL must be a Cloudflare R2 endpoint, got ${endpoint}`)
  }
  return {
    name: "r2",
    endpoint,
    bucket: required("AWS_S3_BUCKET"),
    client: makeClient({
      endpoint,
      accessKeyId: required("S3_KEY_ID"),
      secretAccessKey: required("S3_SECRET_KEY"),
      region: process.env.AWS_REGION?.trim() || "auto",
    }),
  }
}

function timewebSource() {
  const fields = [
    "TW_S3_URL",
    "TW_S3_BUCKET",
    "TW_S3_ACCESS_KEY",
    "TW_S3_SECRET_KEY",
  ]
  const present = fields.filter((name) => Boolean(process.env[name]?.trim()))
  if (present.length === 0) return null
  if (present.length !== fields.length) {
    throw new Error(`Timeweb configuration is incomplete; set ${fields.join(", ")}`)
  }
  return {
    name: "timeweb",
    endpoint: required("TW_S3_URL"),
    bucket: required("TW_S3_BUCKET"),
    client: makeClient({
      endpoint: required("TW_S3_URL"),
      accessKeyId: required("TW_S3_ACCESS_KEY"),
      secretAccessKey: required("TW_S3_SECRET_KEY"),
      region: process.env.TW_S3_REGION?.trim() || "ru-1",
    }),
  }
}

async function listAll(source) {
  const entries = []
  let token
  do {
    const page = await source.client.send(
      new ListObjectsV2Command({
        Bucket: source.bucket,
        ContinuationToken: token,
      }),
    )
    for (const item of page.Contents ?? []) {
      if (item.Key && !item.Key.endsWith("/")) entries.push(item)
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return entries
}

async function head(client, bucket, key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode
    if (status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      return null
    }
    throw error
  }
}

function legacyProjectParts(key) {
  const match = key.match(/^(?:(?:innohub|ffworks)\/)?projects\/([^/]+)\/(.+)$/)
  return match ? { projectId: match[1], relative: match[2] } : null
}

function targetKeyFor(input, projectsById, filesByKey) {
  const current = input.key.split("/")
  if (
    current.length >= 4 &&
    current[0] === "projects" &&
    UUID_RE.test(current[1]) &&
    UUID_RE.test(current[2])
  ) {
    return input.key
  }
  if (
    current.length >= 3 &&
    UUID_RE.test(current[0]) &&
    UUID_RE.test(current[1])
  ) {
    return `projects/${input.key}`
  }
  if (current.length >= 3 && current[0] === "orphaned-projects") {
    return `projects/orphaned/${current.slice(1).join("/")}`
  }

  const projectParts = legacyProjectParts(input.key)
  if (projectParts) {
    const project = projectsById.get(projectParts.projectId)
    if (project) {
      return `projects/${project.userId}/${project.id}/${projectParts.relative}`
    }
    // Preserve projects deleted from the current DB rather than silently
    // discarding their Timeweb bytes. They can be assigned later if restored.
    return `projects/orphaned/${projectParts.projectId}/${projectParts.relative}`
  }

  const file = filesByKey.get(input.key)
  if (file) {
    const suffix = file.s3Key.split("/").pop()
    if (!suffix) return null
    const folder = file.folderPath ? `${file.folderPath}/` : ""
    return `projects/${file.userId}/${file.projectId}/${folder}${suffix}`
  }

  const withoutLegacyPrefix = input.key.replace(/^(?:innohub|ffworks)\//, "")
  if (
    (input.key.startsWith("innohub/") || input.key.startsWith("ffworks/")) &&
    !withoutLegacyPrefix.includes("/")
  ) {
    // Flat legacy app uploads are catalog/admin media. Put them into the
    // explicit public namespace used by new admin uploads.
    return `admin/${withoutLegacyPrefix}`
  }
  // Non-project objects retain their namespace with only the obsolete global
  // prefix removed. This preserves all Timeweb data without retaining
  // `innohub/`.
  return withoutLegacyPrefix
}

async function copyObject(source, target, key, destinationKey) {
  const response = await source.client.send(
    new GetObjectCommand({ Bucket: source.bucket, Key: key }),
  )
  if (!response.Body) throw new Error("Source object has no body")
  await new Upload({
    client: target.client,
    params: {
      Bucket: target.bucket,
      Key: destinationKey,
      Body: response.Body,
      ContentType: response.ContentType,
      CacheControl: response.CacheControl,
      ContentDisposition: response.ContentDisposition,
      ContentEncoding: response.ContentEncoding,
      Metadata: response.Metadata,
    },
    partSize: 8 * 1024 * 1024,
    queueSize: 3,
    leavePartsOnError: false,
  }).done()
}

function sameSize(a, b) {
  return Number(a ?? -1) === Number(b ?? -2)
}

function encodeObjectKey(key) {
  return key.split("/").map(encodeURIComponent).join("/")
}

const target = r2Target()
const timeweb = timewebSource()
const dbConfig = readConnectionConfig()
const pool = new pg.Pool({ ...dbConfig, ssl: false, max: 2 })

const [
  { rows: projects },
  { rows: files },
  { rows: journalRows },
] = await Promise.all([
  pool.query(`
    SELECT id, user_id AS "userId"
      FROM projects
  `),
  pool.query(`
    SELECT f.s3_key AS "s3Key",
           f.project_id AS "projectId",
           p.user_id AS "userId",
           f.folder_path AS "folderPath"
      FROM project_files f
      JOIN projects p ON p.id = f.project_id
     WHERE f.s3_key IS NOT NULL
  `),
  pool.query(`
    SELECT DISTINCT key, project_id AS "projectId"
      FROM storage_changes
  `),
])

const projectsById = new Map(projects.map((project) => [project.id, project]))
const filesByKey = new Map(files.map((file) => [file.s3Key, file]))
const journalMappings = new Map()
for (const row of journalRows) {
  const parts = legacyProjectParts(row.key)
  const project = parts ? projectsById.get(row.projectId) : null
  if (parts && project) {
    journalMappings.set(
      row.key,
      `projects/${project.userId}/${project.id}/${parts.relative}`,
    )
    continue
  }
  const current = row.key.split("/")
  if (
    current.length >= 3 &&
    UUID_RE.test(current[0]) &&
    UUID_RE.test(current[1])
  ) {
    journalMappings.set(row.key, `projects/${row.key}`)
  }
}
const sources = [{ ...target, name: "legacy-r2" }]
if (timeweb) sources.push(timeweb)

console.log({
  mode: APPLY ? "apply" : "dry-run",
  destination: `${target.endpoint}/${target.bucket}`,
  sources: sources.map((source) => `${source.name}:${source.endpoint}/${source.bucket}`),
  projects: projects.length,
  knownProjectFiles: files.length,
  legacyJournalKeys: journalMappings.size,
})

const copiedMappings = new Map()
const legacyR2KeysToDelete = []
const stats = {
  scanned: 0,
  planned: 0,
  copied: 0,
  skipped: 0,
  failed: 0,
  deletedLegacyR2: 0,
}

for (const source of sources) {
  const objects = await listAll(source)
  console.log(`${source.name}: ${objects.length} objects`)

  for (const object of objects) {
    const key = object.Key
    if (!key) continue
    stats.scanned += 1
    const destinationKey = targetKeyFor({ key }, projectsById, filesByKey)
    if (!destinationKey) {
      throw new Error(`Could not determine destination key for ${key}`)
    }
    if (destinationKey === key && source.name === "legacy-r2") {
      stats.skipped += 1
      continue
    }

    stats.planned += 1
    if (!APPLY) {
      console.log(`PLAN ${source.name}:${key} -> ${destinationKey}`)
      continue
    }

    try {
      const destination = await head(target.client, target.bucket, destinationKey)
      if (destination && sameSize(destination.ContentLength, object.Size)) {
        stats.skipped += 1
        copiedMappings.set(key, destinationKey)
        if (source.name === "legacy-r2" && destinationKey !== key) {
          legacyR2KeysToDelete.push(key)
        }
        continue
      }
      await copyObject(source, target, key, destinationKey)
      const verified = await head(target.client, target.bucket, destinationKey)
      if (!verified || !sameSize(verified.ContentLength, object.Size)) {
        throw new Error("Destination verification failed (size mismatch)")
      }
      copiedMappings.set(key, destinationKey)
      if (source.name === "legacy-r2" && destinationKey !== key) {
        legacyR2KeysToDelete.push(key)
      }
      stats.copied += 1
      console.log(`COPIED ${source.name}:${key} -> ${destinationKey}`)
    } catch (error) {
      stats.failed += 1
      console.error(`FAILED ${source.name}:${key}`, error instanceof Error ? error.message : error)
    }
  }
}

if (APPLY && (copiedMappings.size > 0 || journalMappings.size > 0)) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const [oldKey, newKey] of copiedMappings) {
      if (oldKey === newKey) continue
      await client.query(`UPDATE project_files SET s3_key = $2 WHERE s3_key = $1`, [
        oldKey,
        newKey,
      ])
      await client.query(`UPDATE storage_changes SET key = $2 WHERE key = $1`, [
        oldKey,
        newKey,
      ])
      await client.query(
        `UPDATE videos
            SET thumbnail = REPLACE(REPLACE(thumbnail, $1, $2), $3, $4),
                video_url = REPLACE(REPLACE(video_url, $1, $2), $3, $4)
          WHERE thumbnail LIKE '%' || $1 || '%'
             OR video_url LIKE '%' || $1 || '%'
             OR thumbnail LIKE '%' || $3 || '%'
             OR video_url LIKE '%' || $3 || '%'`,
        [oldKey, newKey, encodeObjectKey(oldKey), encodeObjectKey(newKey)],
      )
      await client.query(
        `UPDATE ideas
            SET thumbnail = REPLACE(REPLACE(thumbnail, $1, $2), $3, $4),
                video_url = REPLACE(REPLACE(video_url, $1, $2), $3, $4)
          WHERE thumbnail LIKE '%' || $1 || '%'
             OR video_url LIKE '%' || $1 || '%'
             OR thumbnail LIKE '%' || $3 || '%'
             OR video_url LIKE '%' || $3 || '%'`,
        [oldKey, newKey, encodeObjectKey(oldKey), encodeObjectKey(newKey)],
      )
    }
    for (const [oldKey, newKey] of journalMappings) {
      if (oldKey === newKey) continue
      await client.query(`UPDATE storage_changes SET key = $2 WHERE key = $1`, [
        oldKey,
        newKey,
      ])
    }
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

if (APPLY && DELETE_LEGACY_R2 && legacyR2KeysToDelete.length > 0) {
  const result = await target.client.send(
    new DeleteObjectsCommand({
      Bucket: target.bucket,
      Delete: {
        Objects: legacyR2KeysToDelete.map((Key) => ({ Key })),
        Quiet: true,
      },
    }),
  )
  if (result.Errors && result.Errors.length > 0) {
    throw new Error(
      `Failed to remove ${result.Errors.length} verified legacy R2 objects.`,
    )
  }
  stats.deletedLegacyR2 = legacyR2KeysToDelete.length
}

await pool.end()
console.log({
  ...stats,
  dbKeysUpdated: APPLY ? copiedMappings.size : 0,
  journalKeysUpdated: APPLY ? journalMappings.size : 0,
})
if (stats.failed > 0) process.exit(1)
