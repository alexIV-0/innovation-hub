import "dotenv/config"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

const DEFAULT_PREFIX = "innohub"

function normalizePrefix(raw) {
  const trimmed = (raw ?? DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "")
  return trimmed || DEFAULT_PREFIX
}

function envBool(name, defaultWhenUnset) {
  const v = process.env[name]
  if (v === undefined || v === "") return defaultWhenUnset
  return v === "1" || v.toLowerCase() === "true"
}

const prefix = normalizePrefix(process.env.AWS_S3_PREFIX)
const markerKey = `${prefix}/.keep`
const bucket = process.env.AWS_S3_BUCKET

if (!bucket) {
  console.error("AWS_S3_BUCKET is not set.")
  process.exit(1)
}

const accessKeyId =
  process.env.S3_KEY_ID ??
  process.env.AWS_KEY_ID ??
  process.env.AWS_ACCESS_KEY_ID ??
  ""
const secretAccessKey =
  process.env.S3_SECRET_KEY ??
  process.env.AWS_SECRET_KEY ??
  process.env.AWS_SECRET_ACCESS_KEY ??
  ""

if (!accessKeyId || !secretAccessKey) {
  console.error(
    "S3 credentials missing: set S3_KEY_ID and S3_SECRET_KEY (or AWS_KEY_ID/AWS_SECRET_KEY, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).",
  )
  process.exit(1)
}

const region = process.env.AWS_REGION?.trim() || "auto"
const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
if (endpoint && /twcstorage\.ru/i.test(endpoint)) {
  console.error(
    "AWS_ENDPOINT_URL points at Timeweb. Use the Cloudflare R2 endpoint instead.",
  )
  process.exit(1)
}
const client = new S3Client({
  region,
  endpoint: endpoint || undefined,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: envBool("AWS_S3_FORCE_PATH_STYLE", Boolean(endpoint)),
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})

try {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: markerKey,
      Body: "",
      ContentType: "binary/octet-stream",
    }),
  )
  console.log(`OK: wrote placeholder object "${markerKey}" in bucket "${bucket}".`)
  process.exit(0)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
