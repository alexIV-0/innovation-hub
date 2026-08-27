/**
 * Служебный аккаунт для шаблонов пробного периода.
 *
 * Заводит пользователя, чьи проекты становятся пробным набором. Отдельная
 * сущность для этого не нужна: раскладка в R2 — `projects/{userId}/{projectId}/`,
 * а зеркало в десктопе — `<корень>/<владелец>/<проект>/`, где имя папки берётся
 * из ПОЧТЫ. То есть «папка шаблонов» и есть аккаунт, а её имя — его адрес.
 *
 * Роль USER, а не ADMIN, намеренно. Машинный токен читает роль живым запросом
 * (lib/storage/auth.ts), и админский токен видел бы ЧУЖИЕ проекты: подключив
 * его к десктопу, вы получили бы в зеркале весь сайт. Аккаунту нужно ровно
 * три вещи — войти, выпустить себе токен и владеть проектами; админских прав
 * ни одна из них не требует.
 *
 * `billing_exempt` включаем: если шаблон временно снять с пометки и прогнать
 * через конвейер для проверки, прогон не должен ничего стоить. Учёт при этом
 * ведётся — строкой `exempt`, чтобы расход на внешних сервисах не пропал.
 *
 * Идемпотентно: повторный запуск обновляет пароль и флаги, но не создаёт
 * второго аккаунта и не трогает уже заведённые проекты.
 *
 * Заодно выпускает машинный токен `mch_…`. Интерфейса для него нет нигде:
 * единственный вход — `POST /api/account/machine-tokens`, то есть из браузера
 * под этим же аккаунтом. Гонять человека через devtools ради одной строки
 * незачем, а формат токена и хеширование здесь повторены один в один с
 * `lib/storage/write-path.ts` — разойдись они, токен просто не подошёл бы.
 *
 * Запуск:
 *   TEMPLATES_EMAIL=templates@ffworks.pro TEMPLATES_PASSWORD=... \
 *     node scripts/billing-templates-account.mjs
 *
 * Пароль и токен можно не задавать — сгенерируем и напечатаем один раз.
 * Повторный запуск выпускает ЕЩЁ один токен: старые не отзываются, потому что
 * ими могут ходить другие машины.
 */
import "dotenv/config"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import bcrypt from "bcryptjs"
import { Client } from "pg"
import { readConnectionConfig, resolvePgSsl } from "./pg-connection.mjs"

const email = (process.env.TEMPLATES_EMAIL ?? "templates@ffworks.pro")
  .trim()
  .toLowerCase()
const generated = !process.env.TEMPLATES_PASSWORD
const password =
  process.env.TEMPLATES_PASSWORD ?? randomBytes(12).toString("base64url")

let config
try {
  config = readConnectionConfig()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

const client = new Client({
  user: config.user,
  password: config.password,
  host: config.host,
  port: config.port,
  database: config.database,
  ssl: resolvePgSsl(),
})

async function main() {
  await client.connect()

  const passwordHash = await bcrypt.hash(password, 10)

  const result = await client.query(
    `INSERT INTO users (
       id, full_name, email, password_hash, role, is_active,
       auth_provider, billing_exempt
     )
     VALUES ($1, $2, $3, $4, 'USER', TRUE, 'local', TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash  = EXCLUDED.password_hash,
           is_active      = TRUE,
           billing_exempt = TRUE
     RETURNING id, (xmax = 0) AS created`,
    [randomUUID(), "Шаблоны пробного периода", email, passwordHash],
  )

  const { id, created } = result.rows[0]

  // Формат — `mch_` + 32 случайных байта в base64url, хранится только SHA-256.
  // Обе половины повторяют lib/storage/write-path.ts.
  const rawToken = `mch_${randomBytes(32).toString("base64url")}`
  const tokenHash = createHash("sha256").update(rawToken).digest("hex")
  await client.query(
    `INSERT INTO machine_tokens (id, user_id, project_id, name, token_hash)
     VALUES ($1, $2, NULL, $3, $4)`,
    [randomUUID(), id, "Шаблоны пробного периода", tokenHash],
  )

  const templates = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE(is_template, FALSE))::int AS marked
       FROM projects
      WHERE user_id = $1 AND deleted_at IS NULL`,
    [id],
  )
  const { total, marked } = templates.rows[0]

  console.log("")
  console.log(created ? "Аккаунт создан." : "Аккаунт уже был, обновлён.")
  console.log(`  почта:   ${email}`)
  console.log(`  id:      ${id}`)
  console.log(`  проекты: ${total}, из них в пробном наборе: ${marked}`)
  if (generated) {
    console.log(`  пароль:  ${password}`)
    console.log("  (сгенерирован; больше нигде не показывается)")
  }
  console.log(`  токен:   ${rawToken}`)
  console.log("  (показывается один раз; в базе только хеш)")
  console.log("")
  console.log("Дальше:")
  console.log("  1. Вписать токен в настройки десктопа")
  console.log(
    `  2. Завести проекты — в зеркале они лягут под папкой «${email}»`,
  )
  console.log("  3. Наполнить IN и положить options/options.json")
  console.log("  4. В админке «Тарифы» отметить их как пробный набор")
  console.log("")
  console.log(
    `Войти на сайт под ${email} можно тем же паролем, но для шаблонов это не нужно:`,
  )
  console.log("проекты правятся из десктопа, набор собирается в админке.")
  console.log("")
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => client.end())
