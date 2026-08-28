/**
 * Сводит папку options каждого проекта к одному объекту на логическое имя.
 *
 * Зачем. Раньше десктоп заливал служебные JSON-ы обычным путём
 * (presign → PUT → notify), а presign минтит физический ключ `{uuid}-{имя}`.
 * Сайт же читает folderState.json, options.json и description.md по фиксированному
 * ключу без uuid. В результате под одним префиксом оказались два-три объекта с
 * одним и тем же логическим именем: сайт видел свой, программа — свой.
 *
 * Пока это не разобрано, включать options в reindex нельзя: логическое имя у
 * двойников одно, а `project_files_unique_name_idx` (project_id, lower(folder_path),
 * lower(name)) держит уникальность — вставка второго упала бы и отменила весь
 * реиндекс проекта.
 *
 * Правило выбора: живёт КАНОНИЧЕСКИЙ ключ (его читает сайт), содержимое берётся
 * САМОЕ СВЕЖЕЕ по LastModified. Если свежее лежит у двойника с uuid — его байты
 * копируются на канонический ключ. Расхождения печатаются поимённо: там, где
 * содержимое двойников разное, выбор сделан за пользователя, и это должно быть
 * видно в логе, а не молча.
 *
 * Строки каталога не создаются и не удаляются — только перенаправляются на
 * выживший ключ. Создание строк — дело reindex и writeSidecarSync.
 *
 *   node scripts/storage-options-consolidate.mjs                    # dry-run, все проекты
 *   node scripts/storage-options-consolidate.mjs --project <id>     # dry-run, один проект
 *   node scripts/storage-options-consolidate.mjs --apply            # выполнить
 */
import "dotenv/config"
import pg from "pg"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3"
import { readConnectionConfig } from "./pg-connection.mjs"

const APPLY = process.argv.includes("--apply")
const projectArgIndex = process.argv.indexOf("--project")
const ONLY_PROJECT =
  projectArgIndex >= 0 ? process.argv[projectArgIndex + 1]?.trim() : null

const OPTIONS_FOLDER_NAME = "options"
/** Их читает сайт по фиксированному ключу — только они обязаны жить без uuid. */
const CANONICAL_SIDECAR_NAMES = new Set([
  "folderstate.json",
  "options.json",
  "description.md",
])
const OBJECT_NAME_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i

function requireEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing env ${name}`)
  return value
}

function createS3() {
  const bucket = requireEnv("AWS_S3_BUCKET")
  const endpoint = process.env.AWS_ENDPOINT_URL?.trim()
  if (!endpoint) throw new Error("Missing AWS_ENDPOINT_URL (R2)")
  if (/twcstorage\.ru/i.test(endpoint)) {
    throw new Error("AWS_ENDPOINT_URL points at Timeweb. Refusing. Use R2.")
  }

  const accessKeyId =
    process.env.S3_KEY_ID ||
    process.env.AWS_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey =
    process.env.S3_SECRET_KEY ||
    process.env.AWS_SECRET_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3_KEY_ID / S3_SECRET_KEY")
  }

  return {
    bucket,
    client: new S3Client({
      region: process.env.AWS_REGION?.trim() || "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  }
}

function logicalNameFromKey(key) {
  const basename = key.slice(key.lastIndexOf("/") + 1)
  const match = basename.match(OBJECT_NAME_UUID_RE)
  return match?.[1]?.length ? match[1] : basename
}

async function listOptionsObjects(client, bucket, prefix) {
  const objects = []
  let token
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    )
    for (const obj of page.Contents ?? []) {
      if (!obj.Key || obj.Key.endsWith("/")) continue
      objects.push({
        key: obj.Key,
        size: Number(obj.Size ?? 0),
        etag: obj.ETag?.replace(/"/g, "") ?? null,
        lastModified: obj.LastModified ? obj.LastModified.getTime() : 0,
      })
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined
  } while (token)
  return objects
}

/**
 * Логический путь объекта внутри проекта: `options` или `options/<подпапка>`.
 * Подпапки в options такие же настоящие, как везде (например `options/__stat`).
 */
function describe(key, projectPrefix) {
  const relative = key.slice(projectPrefix.length)
  const segments = relative.split("/")
  const basename = segments.pop() ?? ""
  return {
    key,
    folderPath: segments.join("/"),
    name: logicalNameFromKey(basename),
    /** Ключ, по которому этот же файл лежал бы без uuid-префикса. */
    canonicalKey: `${projectPrefix}${[...segments, logicalNameFromKey(basename)].join("/")}`,
  }
}

function pickWinner(candidates) {
  return [...candidates].sort((a, b) => {
    if (b.lastModified !== a.lastModified) return b.lastModified - a.lastModified
    return a.key.localeCompare(b.key)
  })[0]
}

async function consolidateProject(ctx, project) {
  const { client, bucket, pool } = ctx
  const projectPrefix = `projects/${project.storageOwnerId}/${project.id}/`
  const optionsPrefix = `${projectPrefix}${OPTIONS_FOLDER_NAME}/`

  const objects = await listOptionsObjects(client, bucket, optionsPrefix)
  if (objects.length === 0) return null

  const groups = new Map()
  for (const object of objects) {
    const info = describe(object.key, projectPrefix)
    const groupKey = `${info.folderPath}\u0000${info.name.toLowerCase()}`
    const group = groups.get(groupKey)
    const entry = { ...object, ...info }
    if (group) group.push(entry)
    else groups.set(groupKey, [entry])
  }

  const actions = []

  for (const group of groups.values()) {
    const first = group[0]
    const mustBeCanonical = CANONICAL_SIDECAR_NAMES.has(first.name.toLowerCase())
    const winner = pickWinner(group)
    const canonicalKey = first.canonicalKey
    const canonicalPresent = group.some((item) => item.key === canonicalKey)

    // Ничего делать не нужно: один объект, и он уже там, где его ищут.
    if (group.length === 1 && (!mustBeCanonical || canonicalPresent)) continue

    // Байты выжившего должны оказаться на каноническом ключе, если файл из тех
    // трёх, которые сайт читает по фиксированному пути.
    const survivorKey = mustBeCanonical ? canonicalKey : winner.key
    const needsCopy = survivorKey !== winner.key

    const distinctEtags = new Set(group.map((item) => item.etag))
    actions.push({
      folderPath: first.folderPath,
      name: first.name,
      survivorKey,
      copyFrom: needsCopy ? winner.key : null,
      remove: group
        .map((item) => item.key)
        .filter((key) => key !== survivorKey),
      /** Двойники с разным содержимым — здесь выбор сделан за пользователя. */
      diverged: distinctEtags.size > 1,
      candidates: group.length,
    })
  }

  if (actions.length === 0) return null

  for (const action of actions) {
    const label = `${project.id} ${action.folderPath}/${action.name}`
    console.log(
      `${APPLY ? "•" : "?"} ${label}: ${action.candidates} объект(ов)` +
        `${action.diverged ? " — СОДЕРЖИМОЕ РАЗНОЕ" : ""}`,
    )
    if (action.copyFrom) {
      console.log(`    копия ${action.copyFrom} → ${action.survivorKey}`)
    }
    for (const key of action.remove) console.log(`    удалить ${key}`)

    if (!APPLY) continue

    if (action.copyFrom) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: action.survivorKey,
          CopySource: encodeURI(`${bucket}/${action.copyFrom}`),
          MetadataDirective: "COPY",
        }),
      )
    }
    for (const key of action.remove) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    }
    // Строку каталога переводим на выживший ключ: file_id при этом сохраняется,
    // поэтому у клиента файл остаётся тем же файлом, а не новым.
    await pool.query(
      `UPDATE project_files
          SET s3_key = $4, updated_at = NOW()
        WHERE project_id = $1
          AND lower(folder_path) = lower($2)
          AND lower(name) = lower($3)
          AND deleted_at IS NULL`,
      [project.id, action.folderPath, action.name, action.survivorKey],
    )
  }

  return {
    projectId: project.id,
    groups: actions.length,
    removed: actions.reduce((sum, a) => sum + a.remove.length, 0),
    diverged: actions.filter((a) => a.diverged).length,
  }
}

const { bucket, client } = createS3()
const pool = new pg.Pool({ ...readConnectionConfig(), ssl: false, max: 2 })

console.log(
  APPLY
    ? `Консолидация options в бакете ${bucket} — ВЫПОЛНЕНИЕ`
    : `Консолидация options в бакете ${bucket} — dry-run (добавьте --apply)`,
)

try {
  const { rows: projects } = await pool.query(
    ONLY_PROJECT
      ? `SELECT id, COALESCE(storage_owner_id, user_id) AS "storageOwnerId" FROM projects WHERE id = $1`
      : `SELECT id, COALESCE(storage_owner_id, user_id) AS "storageOwnerId" FROM projects ORDER BY created_at ASC`,
    ONLY_PROJECT ? [ONLY_PROJECT] : [],
  )

  if (projects.length === 0) {
    console.log("Проектов не найдено.")
  }

  const summary = []
  for (const project of projects) {
    const result = await consolidateProject({ client, bucket, pool }, project)
    if (result) summary.push(result)
  }

  if (summary.length === 0) {
    console.log("Дублей под options нет — консолидировать нечего.")
  } else {
    const totals = summary.reduce(
      (acc, item) => ({
        groups: acc.groups + item.groups,
        removed: acc.removed + item.removed,
        diverged: acc.diverged + item.diverged,
      }),
      { groups: 0, removed: 0, diverged: 0 },
    )
    console.log(
      `\nПроектов затронуто: ${summary.length}; имён сведено: ${totals.groups}; ` +
        `объектов ${APPLY ? "удалено" : "к удалению"}: ${totals.removed}; ` +
        `из них с разным содержимым: ${totals.diverged}`,
    )
    if (!APPLY) console.log("Ничего не изменено. Повторите с --apply.")
  }
} finally {
  await pool.end()
}
