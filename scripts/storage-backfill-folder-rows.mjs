/**
 * Заводит строки-папки для путей, на которых уже что-то лежит.
 *
 * Зачем. Дерево проекта строится спуском по строкам-папкам: `buildTree` берёт
 * детей папки только у той папки, чья строка есть в каталоге. Заливка через
 * presign → notify создавала строку файла с `folder_path = 'IN'`, но саму папку
 * `IN` не заводил никто — её создавал только явный `/mkdir`. Если клиент его не
 * позвал, файл в каталоге есть, а в дереве не видно ни его, ни папки.
 *
 * Именно так пропадали IN и OUT: файлы лежат на `IN` и `OUT/08 August`, а
 * строк-папок `IN` и `OUT` нет. Код уже исправлен (writeNotifyUpload заводит
 * папки по пути заливки), но накопленные данные это не лечит — их лечит этот
 * скрипт.
 *
 * Промежуточные сегменты тоже создаются: для `OUT/08 August` появятся и `OUT`,
 * и `OUT/08 August`. Каждая новая папка журналируется, иначе десктоп узнает о
 * ней только после полного `/tree`.
 *
 * Ничего не удаляет и не переименовывает. Повторный запуск безопасен.
 *
 *   node scripts/storage-backfill-folder-rows.mjs                 # dry-run, все проекты
 *   node scripts/storage-backfill-folder-rows.mjs --project <id>   # dry-run, один проект
 *   node scripts/storage-backfill-folder-rows.mjs --apply          # выполнить
 */
import "dotenv/config"
import { randomUUID } from "node:crypto"
import pg from "pg"
import { readConnectionConfig } from "./pg-connection.mjs"

const APPLY = process.argv.includes("--apply")
const projectArgIndex = process.argv.indexOf("--project")
const ONLY_PROJECT =
  projectArgIndex >= 0 ? process.argv[projectArgIndex + 1]?.trim() : null

const pool = new pg.Pool({ ...readConnectionConfig(), ssl: false, max: 2 })

/** Ключ логической папки — тот же, что строит logicalKeyForFile в lib/storage/keys.ts. */
function logicalFolderKey(storageOwnerId, projectId, folderPath) {
  return `projects/${storageOwnerId}/${projectId}/${folderPath}`
}

function splitParent(path) {
  const at = path.lastIndexOf("/")
  return at < 0
    ? { parent: "", name: path }
    : { parent: path.slice(0, at), name: path.slice(at + 1) }
}

async function backfillProject(client, project) {
  const { rows } = await client.query(
    `SELECT folder_path AS "folderPath", name, is_folder AS "isFolder"
       FROM project_files
      WHERE project_id = $1 AND deleted_at IS NULL`,
    [project.id],
  )
  if (rows.length === 0) return null

  // Что уже существует как папка, с приведением регистра: уникальный индекс
  // каталога регистронезависимый, поэтому и сверяться надо так же.
  const existing = new Set(
    rows
      .filter((r) => r.isFolder)
      .map((r) => (r.folderPath ? `${r.folderPath}/${r.name}` : r.name).toLowerCase()),
  )

  // Все пути, на которых что-то лежит, вместе с промежуточными сегментами.
  const needed = new Set()
  for (const row of rows) {
    const path = row.folderPath?.replace(/^\/+|\/+$/g, "")
    if (!path) continue
    const segments = path.split("/")
    for (let i = 1; i <= segments.length; i++) {
      needed.add(segments.slice(0, i).join("/"))
    }
  }

  // От коротких к длинным: родитель должен появиться раньше ребёнка.
  const missing = [...needed]
    .filter((path) => !existing.has(path.toLowerCase()))
    .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))

  if (missing.length === 0) return null

  console.log(`\n${project.name} (${project.id})`)
  for (const path of missing) console.log(`  ${APPLY ? "+" : "?"} папка ${path}`)
  if (!APPLY) return { projectId: project.id, created: missing.length }

  for (const path of missing) {
    const { parent, name } = splitParent(path)
    const id = randomUUID()
    const inserted = await client.query(
      `INSERT INTO project_files (
          id, project_id, folder_path, name, is_folder, s3_key, size_bytes, content_type
       )
       VALUES ($1, $2, $3, $4, TRUE, NULL, 0, '')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [id, project.id, parent, name],
    )
    // Гонка с параллельной заливкой: папку успели завести, вставлять вторую нельзя.
    if (inserted.rows.length === 0) {
      console.log(`    (уже появилась, пропускаю: ${path})`)
      continue
    }

    const seq = await client.query(
      `INSERT INTO storage_changes (
          project_id, key, op, size, event_time, event_id, payload
       )
       VALUES ($1, $2, 'put', 0, $3, $4, $5::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING seq`,
      [
        project.id,
        logicalFolderKey(project.storageOwnerId, project.id, path),
        Math.floor(Date.now() / 1000),
        `backfill:mkdir:${id}`,
        JSON.stringify({ fileId: id, name, folderPath: parent, isFolder: true }),
      ],
    )
    if (seq.rows[0]) {
      await client.query(
        `UPDATE project_files SET last_seq = $2 WHERE id = $1`,
        [id, seq.rows[0].seq],
      )
    }
  }

  return { projectId: project.id, created: missing.length }
}

console.log(
  APPLY
    ? "Бэкфилл строк-папок — ВЫПОЛНЕНИЕ"
    : "Бэкфилл строк-папок — dry-run (добавьте --apply)",
)

try {
  const { rows: projects } = await pool.query(
    ONLY_PROJECT
      ? `SELECT id, name, COALESCE(storage_owner_id, user_id) AS "storageOwnerId" FROM projects
          WHERE id = $1 AND deleted_at IS NULL`
      : `SELECT id, name, COALESCE(storage_owner_id, user_id) AS "storageOwnerId" FROM projects
          WHERE deleted_at IS NULL ORDER BY created_at ASC`,
    ONLY_PROJECT ? [ONLY_PROJECT] : [],
  )

  const summary = []
  for (const project of projects) {
    // Транзакция на проект: либо все его папки, либо ни одной.
    const client = await pool.connect()
    try {
      await client.query("BEGIN")
      const result = await backfillProject(client, project)
      await client.query(APPLY ? "COMMIT" : "ROLLBACK")
      if (result) summary.push(result)
    } catch (error) {
      await client.query("ROLLBACK")
      console.error(`  ОШИБКА в проекте ${project.id}:`, error.message)
    } finally {
      client.release()
    }
  }

  if (summary.length === 0) {
    console.log("\nВсе пути достижимы — создавать нечего.")
  } else {
    const total = summary.reduce((sum, item) => sum + item.created, 0)
    console.log(
      `\nПроектов затронуто: ${summary.length}; папок ${APPLY ? "создано" : "к созданию"}: ${total}`,
    )
    if (!APPLY) console.log("Ничего не изменено. Повторите с --apply.")
  }
} finally {
  await pool.end()
}
