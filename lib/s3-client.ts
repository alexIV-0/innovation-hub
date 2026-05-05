import { S3Client } from "@aws-sdk/client-s3"

let client: S3Client | null = null

function envFlag(name: string, defaultWhenUnset: boolean): boolean {
  const v = process.env[name]
  if (v === undefined || v === "") return defaultWhenUnset
  return v === "1" || v.toLowerCase() === "true"
}

export function getS3Client(): S3Client {
  if (client) return client

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
    throw new Error(
      "S3 credentials missing: set S3_KEY_ID and S3_SECRET_KEY (or AWS_KEY_ID/AWS_SECRET_KEY, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY).",
    )
  }

  const region = process.env.AWS_REGION ?? "us-east-1"
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
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
  })

  return client
}
