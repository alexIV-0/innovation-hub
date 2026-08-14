import { z } from "zod"
import { SETTINGS_DOMAINS, type SettingsDomain } from "@/lib/settings-types"

/**
 * Схемы запросов к общим словарям. Одни на все три поверхности
 * (`/api/storage/v1/settings`, экшены `POST /api/v1`, `/api/admin/settings`) —
 * см. docs/SETTINGS_SYNC.md §7.
 *
 * Здесь только форма запроса. Нормализация значений (цвета, расширения, дубли)
 * живёт в репозитории, чтобы правила были в одном месте и для записи, и для сида.
 */

const domainName = z.enum(SETTINGS_DOMAINS)

const entrySchema = z.object({
  name: z.string().trim().min(1).max(64),
  // Расширения у fileType, сегменты маски у pathPattern, у остальных пуст.
  path: z.array(z.string()).max(256).optional(),
  color: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
})

const domainsSchema = z
  .record(domainName, z.array(entrySchema).max(256))
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one domain.",
  })

export const settingsReadSchema = z.object({
  domains: z.array(domainName).min(1).optional(),
})

export const settingsWriteSchema = z.object({
  // Ревизия, на которой основаны правки. Сервер примет запись только если она не
  // сдвинулась, иначе 409 и клиент сливает три стороны (docs/SETTINGS_SYNC.md §5).
  baseRevision: z.number().int().min(0),
  domains: domainsSchema,
})

export type SettingsReadInput = z.infer<typeof settingsReadSchema>
export type SettingsWriteInput = z.infer<typeof settingsWriteSchema>

/** `?domains=fileType,nodeType` — форма для GET-роутов. */
export function parseDomainsQuery(raw: string | null): SettingsDomain[] | undefined {
  if (!raw) return undefined
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  const parsed = z.array(domainName).safeParse(parts)
  return parsed.success ? parsed.data : undefined
}
