/**
 * Configure CORS on the S3-compatible bucket so the browser can:
 *   - PUT objects via presigned URLs (uploads)
 *   - GET / HEAD objects (range requests for <video>, <img>)
 *
 * Origins are taken from --origin args, ALLOWED_ORIGINS env (comma-separated),
 * or default to "*".
 *
 * Usage:
 *   node scripts/s3-set-cors.mjs
 *   node scripts/s3-set-cors.mjs --origin https://ff-works.vercel.app --origin http://localhost:3000
 */
import "dotenv/config"
import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3"

function envBool(name, defaultWhenUnset) {
  const v = process.env[name]
  if (v === undefined || v === "") return defaultWhenUnset
  return v === "1" || v.toLowerCase() === "true"
}

function parseOrigins() {
  const fromArgs = []
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === "--origin" && process.argv[i + 1]) {
      fromArgs.push(process.argv[i + 1])
      i += 1
    }
  }
  if (fromArgs.length > 0) return fromArgs

  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  if (fromEnv.length > 0) return fromEnv

  return ["*"]
}

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

const origins = parseOrigins()

const corsConfig = {
  CORSRules: [
    {
      ID: "innohub-uploads",
      AllowedOrigins: origins,
      AllowedMethods: ["PUT", "POST"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
    {
      ID: "innohub-reads",
      AllowedOrigins: origins,
      AllowedMethods: ["GET", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"],
      MaxAgeSeconds: 3600,
    },
  ],
}

try {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: corsConfig,
    }),
  )
  console.log(
    `OK: applied CORS to bucket "${bucket}" for origins: ${origins.join(", ")}`,
  )

  const verify = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
  console.log(
    "Active CORS rules:",
    JSON.stringify(verify.CORSRules ?? [], null, 2),
  )
  process.exit(0)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}
