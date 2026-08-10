import { S3Client } from "@aws-sdk/client-s3"

let client: S3Client | null = null

function envFlag(name: string, defaultWhenUnset: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === "") return defaultWhenUnset
  return v === "1" || v.toLowerCase() === "true"
}

function readAccessKeyId(): string {
  return (
    process.env.S3_KEY_ID ??
    process.env.AWS_KEY_ID ??
    process.env.AWS_ACCESS_KEY_ID ??
    ""
  )
}

function readSecretAccessKey(): string {
  return (
    process.env.S3_SECRET_KEY ??
    process.env.AWS_SECRET_KEY ??
    process.env.AWS_SECRET_ACCESS_KEY ??
    ""
  )
}

function assertNotLegacyTimewebEndpoint(endpoint: string | undefined): void {
  if (!endpoint) return
  if (/twcstorage\.ru/i.test(endpoint)) {
    throw new Error(
      "AWS_ENDPOINT_URL still points at Timeweb (twcstorage.ru). Project storage must use Cloudflare R2 — set AWS_ENDPOINT_URL to https://<accountid>.r2.cloudflarestorage.com and matching S3_KEY_ID / S3_SECRET_KEY.",
    )
  }
}

/** True when bucket + credentials are present (R2 / S3-compatible). */
export function isS3Configured(): boolean {
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
  if (endpoint && /twcstorage\.ru/i.test(endpoint)) return false
  return Boolean(process.env.AWS_S3_BUCKET?.trim() && readAccessKeyId() && readSecretAccessKey())
}

export function getS3Client(): S3Client {
  if (client) return client

  const accessKeyId = readAccessKeyId()
  const secretAccessKey = readSecretAccessKey()

  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 credentials missing: set S3_KEY_ID and S3_SECRET_KEY (or AWS_KEY_ID/AWS_SECRET_KEY, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).",
    )
  }

  // Cloudflare R2 uses region "auto"; set AWS_REGION explicitly for AWS S3.
  const region = process.env.AWS_REGION?.trim() || "auto"
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
  assertNotLegacyTimewebEndpoint(endpoint)
  const forcePathStyle = envFlag(
    "AWS_S3_FORCE_PATH_STYLE",
    Boolean(endpoint),
  )

  client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle,
    /**
     * Disable the SDK's flexible-checksum middleware. Since
     * @aws-sdk/client-s3 3.731+ the default ("WHEN_SUPPORTED") adds
     * x-amz-sdk-checksum-algorithm / x-amz-checksum-crc32 to the SIGNED
     * headers of presigned PUT URLs. Browsers don't send those headers
     * on a presigned PUT, so the upload's full body is accepted but the
     * final response is rejected as a signature mismatch — which surfaces
     * as a CORS / network error in XHR.
     *
     * Many S3-compatible providers also do not implement the
     * flexible-checksum extension at all, so disabling here is the
     * safe default for both same-origin Upload() and presigned PUT.
     * https://github.com/aws/aws-sdk-js-v3/issues/6810
     */
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  })

  return client
}
