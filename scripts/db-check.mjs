import "dotenv/config"
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Client } from "pg"

function mask(value) {
  if (!value) return "(empty)"
  if (value.length <= 4) return `${value.length}ch:****`
  return `${value.length}ch:${value.slice(0, 2)}***${value.slice(-2)}`
}

const cfg = {
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE,
}

console.log("Loaded env:")
console.log("  PGUSER     =", cfg.user)
console.log("  PGPASSWORD =", mask(cfg.password))
console.log("  PGHOST     =", cfg.host)
console.log("  PGPORT     =", cfg.port)
console.log("  PGDATABASE =", cfg.database)

const rootCertPath =
  process.env.PGSSLROOTCERT ?? join(homedir(), ".cloud-certs", "root.crt")

if (!existsSync(rootCertPath)) {
  console.error(`Root cert not found at ${rootCertPath}`)
  process.exit(1)
}

const client = new Client({
  ...cfg,
  ssl: {
    rejectUnauthorized: true,
    ca: readFileSync(rootCertPath, "utf8"),
  },
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
