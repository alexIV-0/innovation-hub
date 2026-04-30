import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export function readConnectionConfig() {
  const direct = {
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    database: process.env.PGDATABASE,
  }

  if (direct.user && direct.password && direct.host && direct.database) {
    return {
      user: direct.user,
      password: direct.password,
      host: direct.host,
      port: Number(direct.port || "5432"),
      database: direct.database,
    }
  }

  const connectionString = process.env.DB_CONNECTION_STRING
  if (!connectionString) {
    throw new Error(
      "Set PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE or DB_CONNECTION_STRING.",
    )
  }

  const parsed = new URL(connectionString)
  return {
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    host: parsed.hostname,
    port: Number(parsed.port || "5432"),
    database: parsed.pathname.replace(/^\//, ""),
  }
}

function sslModeFromConnectionString() {
  const cs = process.env.DB_CONNECTION_STRING
  if (!cs) return null
  try {
    return new URL(cs).searchParams.get("sslmode")
  } catch {
    return null
  }
}

/** @returns {import('pg').ClientConfig['ssl'] | undefined} */
export function resolvePgSsl() {
  const explicitPath = process.env.PGSSLROOTCERT
  const defaultCloudPath = join(homedir(), ".cloud-certs", "root.crt")

  let certPath
  if (explicitPath) {
    certPath = explicitPath
  } else if (existsSync(defaultCloudPath)) {
    certPath = defaultCloudPath
  }

  if (certPath) {
    if (!existsSync(certPath)) {
      throw new Error(
        `PostgreSQL root certificate not found at ${certPath} (PGSSLROOTCERT).`,
      )
    }
    return {
      ca: readFileSync(certPath, "utf8"),
      rejectUnauthorized: true,
    }
  }

  const fromUrl = sslModeFromConnectionString()
  const mode =
    process.env.PGSSLMODE ?? fromUrl ?? (process.env.VERCEL ? "require" : undefined)

  if (mode === "disable" || process.env.DATABASE_SSL === "false") {
    return undefined
  }

  if (
    mode === "no-verify" ||
    process.env.PGSSL_NO_VERIFY === "1" ||
    process.env.PGSSLMODE === "no-verify"
  ) {
    return { rejectUnauthorized: false }
  }

  if (
    mode === "require" ||
    mode === "verify-ca" ||
    mode === "verify-full" ||
    process.env.DATABASE_SSL === "true"
  ) {
    return { rejectUnauthorized: true }
  }

  return undefined
}
