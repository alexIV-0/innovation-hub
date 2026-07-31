/**
 * Apply pending SQL migrations from db/migrations/.
 *
 * Tracks applied files in schema_migrations (created automatically).
 * Files are applied in lexicographic order; each runs in its own transaction.
 *
 * Usage:
 *   npm run db:migrate
 *   node scripts/db-migrate.mjs
 *   node scripts/db-migrate.mjs --status
 */
import "dotenv/config"
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(__dirname, "..", "db", "migrations")

const STATUS_ONLY = process.argv.includes("--status")

function listMigrationFiles() {
  let entries
  try {
    entries = readdirSync(migrationsDir)
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return []
    }
    throw error
  }
  return entries
    .filter((name) => name.endsWith(".sql") && !name.startsWith("."))
    .sort((a, b) => a.localeCompare(b, "en"))
}

/** Strip leading SQL comments and optional outer BEGIN/COMMIT wrappers. */
function prepareSql(raw) {
  let sql = raw.replace(/^\uFEFF/, "").trim()
  // Allow files that include their own transaction block — runner wraps too.
  sql = sql.replace(/^\s*BEGIN\s*;/i, "").replace(/;\s*COMMIT\s*;?\s*$/i, ";")
  return sql.trim()
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

async function appliedIds(client) {
  const { rows } = await client.query(
    `SELECT id FROM schema_migrations ORDER BY id ASC`,
  )
  return new Set(rows.map((row) => row.id))
}

async function main() {
  let config
  try {
    config = readConnectionConfig()
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }

  const files = listMigrationFiles()
  const client = new Client({
    user: config.user,
    password: config.password,
    host: config.host,
    port: config.port,
    database: config.database,
    ssl: resolvePgSsl(),
  })

  await client.connect()
  console.log("Connected to PostgreSQL.")

  try {
    await ensureMigrationsTable(client)
    const done = await appliedIds(client)

    if (STATUS_ONLY) {
      if (files.length === 0) {
        console.log("No migration files in db/migrations/.")
        return
      }
      for (const id of files) {
        console.log(`${done.has(id) ? "[done]   " : "[pending]"} ${id}`)
      }
      const pending = files.filter((id) => !done.has(id)).length
      console.log(
        pending === 0
          ? "All migrations applied."
          : `${pending} migration(s) pending.`,
      )
      return
    }

    if (files.length === 0) {
      console.log("No migration files in db/migrations/.")
      return
    }

    let applied = 0
    for (const id of files) {
      if (done.has(id)) {
        console.log(`skip  ${id}`)
        continue
      }

      const fullPath = join(migrationsDir, id)
      const sql = prepareSql(readFileSync(fullPath, "utf8"))
      if (!sql) {
        console.warn(`skip  ${id} (empty file)`)
        continue
      }

      console.log(`apply ${id}`)
      await client.query("BEGIN")
      try {
        await client.query(sql)
        await client.query(
          `INSERT INTO schema_migrations (id) VALUES ($1)`,
          [id],
        )
        await client.query("COMMIT")
        applied += 1
        console.log(`ok    ${id}`)
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      }
    }

    if (applied === 0) {
      console.log("Nothing to apply — database is up to date.")
    } else {
      console.log(`Applied ${applied} migration(s).`)
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
