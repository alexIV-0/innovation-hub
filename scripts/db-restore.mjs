import "dotenv/config"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

// Restores a plain-SQL dump (pg_dump/Adminer format) into the database
// configured via PG* env vars or DB_CONNECTION_STRING.
//
// Usage:
//   node scripts/db-restore.mjs <path-to-dump.sql> [--yes]
//
// Without --yes it only shows the target and current contents (dry run).
// With --yes it drops the whole `public` schema and replays the dump
// inside a single transaction, so a failure leaves the database untouched.

const args = process.argv.slice(2)
const confirmed = args.includes("--yes")
const dumpPath = args.find((a) => !a.startsWith("--"))

if (!dumpPath) {
  console.error("Usage: node scripts/db-restore.mjs <path-to-dump.sql> [--yes]")
  process.exit(1)
}

const dumpSql = readFileSync(dumpPath, "utf8")

let config
try {
  config = readConnectionConfig()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

const client = new Client({ ...config, ssl: resolvePgSsl() })

async function printTableCounts(label) {
  const { rows: tables } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )
  console.log(label)
  if (tables.length === 0) {
    console.log("  (no tables)")
    return
  }
  for (const t of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM "${t.table_name}"`,
    )
    console.log(`  ${t.table_name}: ${rows[0].n}`)
  }
}

async function main() {
  await client.connect()
  console.log(`Target: ${config.user}@${config.host}:${config.port}/${config.database}`)
  console.log(`Dump:   ${dumpPath} (${Math.round(dumpSql.length / 1024)} KB)\n`)

  await printTableCounts("Current contents (will be REPLACED):")

  if (!confirmed) {
    console.log(
      "\nDry run. Re-run with --yes to drop the public schema and restore the dump.",
    )
    return
  }

  console.log("\nRestoring...")
  await client.query("BEGIN")
  try {
    await client.query("DROP SCHEMA public CASCADE")
    await client.query("CREATE SCHEMA public")
    await client.query(dumpSql)
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {})
    throw e
  }

  console.log("Restore complete.\n")
  await printTableCounts("New contents:")
}

main()
  .then(async () => {
    await client.end()
  })
  .catch(async (error) => {
    console.error(error)
    await client.end().catch(() => {})
    process.exit(1)
  })
