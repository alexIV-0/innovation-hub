import { Pool, type PoolClient, type QueryResultRow } from "pg"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

type ConnectionConfig = {
  user: string
  password: string
  host: string
  port: number
  database: string
}

function readEnvConnectionConfig(): ConnectionConfig {
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
      "Database connection is not configured. Set PGUSER/PGPASSWORD/PGHOST/PGPORT/PGDATABASE or DB_CONNECTION_STRING.",
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

const config = readEnvConnectionConfig()

const rootCertPath =
  process.env.PGSSLROOTCERT ?? join(homedir(), ".cloud-certs", "root.crt")

if (!existsSync(rootCertPath)) {
  throw new Error(`PostgreSQL root certificate not found at ${rootCertPath}`)
}

const rootCert = readFileSync(rootCertPath, "utf8")

const globalForPg = globalThis as unknown as { pgPool?: Pool }

export const pool: Pool =
  globalForPg.pgPool ??
  new Pool({
    user: 'gen_user',
    host: '62.76.233.142',
    database: 'default_db',
    password: '+&b8xkt&gDSbxg',
    port: 5432,
    max: 10,
  })

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pool
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  return pool.query<T>(text, params as never[])
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}
