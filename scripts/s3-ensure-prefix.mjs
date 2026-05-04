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
  process.env.AWS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID ?? ""
const secretAccessKey =
  process.env.AWS_SECRET_KEY ?? process.env.AWS_SECRET_ACCESS_KEY ?? ""

if (!accessKeyId || !secretAccessKey) {
  console.error(
    "S3 credentials missing: set AWS_KEY_ID and AWS_SECRET_KEY (or standard AWS_* names).",
  )
  process.exit(1)
}

const region = process.env.AWS_REGION ?? "us-east-1"
const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
const client = new S3Client({
  region,
  endpoint: endpoint || undefined,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: envBool("AWS_S3_FORCE_PATH_STYLE", Boolean(endpoint)),
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
