import "dotenv/config"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

function mask(value) {
  if (!value) return "(empty)"
  if (value.length <= 4) return `${value.length}ch:****`
  return `${value.length}ch:${value.slice(0, 2)}***${value.slice(-2)}`
}

let cfg
try {
  cfg = readConnectionConfig()
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

console.log("Loaded env:")
console.log("  PGUSER     =", cfg.user)
console.log("  PGPASSWORD =", mask(cfg.password))
console.log("  PGHOST     =", cfg.host)
console.log("  PGPORT     =", cfg.port)
console.log("  PGDATABASE =", cfg.database)

const client = new Client({
  ...cfg,
  ssl: resolvePgSsl(),
})

try {
  await client.connect()
  const { rows } = await client.query("SELECT current_user, current_database()")
  console.log("OK ->", rows[0])
  await client.end()
} catch (error) {
  console.error("FAILED:", error.message)
  await client.end().catch(() => {})
  process.exit(1)
}
