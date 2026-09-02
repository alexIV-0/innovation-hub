import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

/**
 * Шифрование секретов сейфа.
 *
 * Мастер-ключ живёт в ОКРУЖЕНИИ, а не в базе. Это и есть весь смысл: дамп базы
 * сам по себе тогда не утечка ключей, а дампы делаются, уезжают и живут в
 * бэкапах дольше самих ключей.
 *
 * AES-256-GCM, а не CBC: GCM даёт не только шифрование, но и проверку
 * целостности — подменённый в базе шифротекст не расшифруется, а не отдаст
 * мусор, который мы отправим вендору.
 *
 * Формат строки: `v1.<iv>.<tag>.<data>`, всё base64url. Версия в начале —
 * чтобы смена алгоритма не потребовала гадать по длине, что перед нами.
 */

const VERSION = "v1"
const IV_BYTES = 12 // рекомендованная длина nonce для GCM
const KEY_BYTES = 32

/**
 * Ключ из окружения. Читается при каждом обращении, а не при загрузке модуля:
 * иначе забытая переменная роняла бы сборку целиком, хотя сейфом пользуются
 * два экрана из сорока.
 */
function masterKey(): Buffer {
  const raw = process.env.VAULT_MASTER_KEY?.trim()
  if (!raw) {
    throw new VaultKeyError(
      "VAULT_MASTER_KEY is not set — the vault cannot encrypt or read secrets.",
    )
  }
  // base64 или hex: и то и другое встречается в инструкциях по генерации, а
  // требовать одно — значит ловить руками ошибку, которую видно по длине.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64")
  if (key.length !== KEY_BYTES) {
    throw new VaultKeyError(
      `VAULT_MASTER_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    )
  }
  return key
}

/**
 * Отдельный класс ошибки: «сайт не настроен» и «секрет испорчен» требуют разных
 * действий от человека, и различать их по тексту сообщения — плохая идея.
 */
export class VaultKeyError extends Error {}

/** Настроен ли сейф. Экран сервисов спрашивает до того, как предложить форму. */
export function vaultConfigured(): boolean {
  try {
    masterKey()
    return true
  } catch {
    return false
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv)
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    data.toString("base64url"),
  ].join(".")
}

export function decryptSecret(packed: string): string {
  const parts = packed.split(".")
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new VaultKeyError("Stored secret is not in the expected v1 format.")
  }
  const [, iv, tag, data] = parts
  const decipher = createDecipheriv(
    "aes-256-gcm",
    masterKey(),
    Buffer.from(iv!, "base64url"),
  )
  decipher.setAuthTag(Buffer.from(tag!, "base64url"))
  return Buffer.concat([
    decipher.update(Buffer.from(data!, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}

/**
 * «••••4f21» — узнать ключ глазами, не доставая его.
 *
 * Четыре последних символа: этого хватает, чтобы отличить два ключа друг от
 * друга и сверить с личным кабинетом вендора, и не хватает, чтобы приблизиться
 * к подбору.
 */
export function secretHint(plain: string): string {
  const tail = plain.trim().slice(-4)
  return tail ? `••••${tail}` : "••••"
}

// ─── Секрет учётки: набор именованных полей ──────────────────────────────────

/**
 * Секрет учётки — не строка, а набор полей: `apiKey`, либо `login` +
 * `password`, либо `client_id` + `client_secret`. Одной строкой их пришлось бы
 * разделять символом, а разделитель однажды встретится внутри пароля.
 */
export type SecretFields = Record<string, string>

/** Поле по умолчанию, когда сервис не описал состав секрета. */
export const DEFAULT_SECRET_FIELD = "apiKey"

export function encryptFields(fields: SecretFields): string {
  return encryptSecret(JSON.stringify(fields))
}

/**
 * Расшифровать секрет учётки.
 *
 * Понимает ДВА формата, и это не запас на будущее, а необходимость: секреты,
 * перенесённые из `vendor_service_secrets`, лежат прежней одной строкой —
 * перешифровать их миграцией нельзя, мастер-ключ в SQL недоступен. Строка
 * читается как `{ apiKey: <строка> }`, и при первой же ротации запись сама
 * переезжает в новый формат.
 *
 * Разбираем через try/catch, а не по первому символу: ключ вендора вполне
 * может начинаться с `{`, и тогда проверка по символу приняла бы его за JSON.
 */
export function decryptFields(packed: string): SecretFields {
  const plain = decryptSecret(packed)
  try {
    const parsed: unknown = JSON.parse(plain)
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.values(parsed).every((value) => typeof value === "string")
    ) {
      return parsed as SecretFields
    }
  } catch {
    // Не JSON — значит прежний формат. Обрабатываем ниже.
  }
  return { [DEFAULT_SECRET_FIELD]: plain }
}

/**
 * Подсказка по главному полю секрета.
 *
 * Главное — первое из описанных сервисом, а без описания `apiKey`. Показывать
 * хвост пароля рядом с логином не стоит: подсказка нужна, чтобы отличить две
 * учётки, и хвоста ключа для этого достаточно.
 */
export function fieldsHint(fields: SecretFields, primary?: string): string {
  const key = primary && fields[primary] != null ? primary : Object.keys(fields)[0]
  return secretHint(key ? (fields[key] ?? "") : "")
}
