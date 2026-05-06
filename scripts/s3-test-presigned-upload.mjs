/**
 * End-to-end check that the presigned-PUT flow works against the live
 * Object Storage bucket using the same SDK config and signing options the
 * production presign route uses.
 *
 *   node scripts/s3-test-presigned-upload.mjs
 *   node scripts/s3-test-presigned-upload.mjs --size 12        # MB, default 12
 *   node scripts/s3-test-presigned-upload.mjs --content-type video/mp4
 *
 * What it does:
 *   1. Builds an S3Client with the SAME config the app uses
 *      (requestChecksumCalculation: WHEN_REQUIRED).
 *   2. Generates a presigned PUT URL for a unique object in the configured
 *      prefix, WITHOUT signing Content-Type (mirroring the API route).
 *   3. Logs the signed query parameters so you can verify SignedHeaders.
 *   4. PUTs random bytes of the requested size with `fetch`, sending the
 *      same Content-Type the browser would send.
 *   5. HEADs the resulting object to confirm it landed and the
 *      Content-Type was stored.
 *   6. DELETEs the test object.
 *
 * If this succeeds and the browser still fails, the problem is purely
 * browser-side (almost always CORS or stale deploy).
 */
import "dotenv/config"
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { randomBytes, randomUUID } from "node:crypto"
import { request as httpsRequest } from "node:https"
import { URL as NodeURL } from "node:url"

function putBuffer(urlStr, contentType, body) {
  return new Promise((resolve, reject) => {
    const u = new NodeURL(urlStr)
    const req = httpsRequest(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        method: "PUT",
        path: `${u.pathname}${u.search}`,
        headers: {
          "content-type": contentType,
          "content-length": body.byteLength,
        },
      },
      (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        )
      },
    )
    req.setTimeout(0)
    req.on("error", reject)
    req.end(body)
  })
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function envBool(name, defaultWhenUnset) {
  const v = process.env[name]
  if (v === undefined || v === "") return defaultWhenUnset
  return v === "1" || v.toLowerCase() === "true"
}

const sizeMb = Number.parseFloat(arg("size", "12"))
const contentType = arg("content-type", "video/mp4")
const prefixDefault = "innohub"

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
  console.error("S3 credentials missing.")
  process.exit(1)
}

const region = process.env.AWS_REGION ?? "us-east-1"
const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
const prefix = (process.env.AWS_S3_PREFIX ?? prefixDefault)
  .replace(/^\/+|\/+$/g, "")

const client = new S3Client({
  region,
  endpoint: endpoint || undefined,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: envBool("AWS_S3_FORCE_PATH_STYLE", Boolean(endpoint)),
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
})

const key = `${prefix}/${randomUUID()}-presign-test.bin`

console.log("Config:")
console.log("  endpoint:    ", endpoint ?? "(default AWS)")
console.log("  region:      ", region)
console.log("  bucket:      ", bucket)
console.log("  key:         ", key)
console.log("  size:        ", `${sizeMb} MB`)
console.log("  contentType: ", contentType)
console.log("")

const command = new PutObjectCommand({ Bucket: bucket, Key: key })

let uploadUrl
try {
  uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 })
} catch (e) {
  console.error("getSignedUrl failed:", e instanceof Error ? e.message : e)
  process.exit(2)
}

console.log("Presigned URL:")
console.log(" ", uploadUrl)

try {
  const url = new URL(uploadUrl)
  const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders")
  console.log("\nSignedHeaders:", signedHeaders)
  if (signedHeaders && /checksum/i.test(signedHeaders)) {
    console.warn(
      "  WARNING: a checksum header is in SignedHeaders. The browser will not be able to send it and the PUT will fail with SignatureDoesNotMatch.",
    )
  }
} catch {
  /* ignore */
}

const body = randomBytes(Math.max(1, Math.floor(sizeMb * 1024 * 1024)))
console.log(`\nPUT ${body.byteLength} bytes…`)

const t0 = Date.now()

/**
 * Use node:https directly so we have no body timeout. Browsers don't apply
 * undici's 5-minute body timeout to XHR uploads either, so this is more
 * representative of the real browser flow on slow upstreams.
 */
let putStatus = 0
let putBody = ""
try {
  const res = await putBuffer(uploadUrl, contentType, body)
  putStatus = res.status
  putBody = res.body
} catch (e) {
  console.error("PUT failed:", e instanceof Error ? e.message : e)
  process.exit(3)
}

const ms = Date.now() - t0
console.log(`PUT response: ${putStatus} in ${ms} ms`)

if (putStatus < 200 || putStatus >= 300) {
  console.error("PUT body:\n", putBody.slice(0, 1000))
  process.exit(4)
}

console.log("\nHEAD object…")
try {
  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key }),
  )
  console.log("  ContentLength:", head.ContentLength)
  console.log("  ContentType:  ", head.ContentType)
  console.log("  ETag:         ", head.ETag)
} catch (e) {
  console.error("HEAD failed:", e instanceof Error ? e.message : e)
  process.exit(5)
}

console.log("\nDELETE object…")
try {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  console.log("  deleted")
} catch (e) {
  console.warn(
    "Could not clean up test object:",
    e instanceof Error ? e.message : e,
  )
}

console.log("\nOK: presigned PUT works against this bucket from Node.")
