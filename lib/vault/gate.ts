import { query } from "@/lib/db"
import { readExposedOption } from "@/lib/options/extract"
import { isMissingTable } from "@/lib/vault/types"

/**
 * Гейт учёток: можно ли вообще ставить задачу по этому графу
 * (VENDOR_KEYS_CLIENT_REQUESTS, пункт 5).
 *
 * Проверка стоит при СБОРКЕ, а не при `claim`, и это принципиально. Попади
 * задача без ключа в очередь, её возьмёт и вернёт каждая машина по очереди,
 * пока `attempts` не упрётся в `maxAttempts` — и умрёт она как «превышены
 * попытки», хотя причина была известна до постановки. Один запрос здесь
 * заменяет весь этот круг.
 *
 * ⚠️ Гейт работает ровно тогда, когда граф несёт слаг сервиса: свойство с
 * `controlType: "vendorAccount"` и `controlProps.service`. Пока таких свойств в
 * графе нет, `collectRequirements` вернёт пустой список, и гейт молча пропустит
 * всё — так и задумано: включать проверку, которой нечего проверять, значит
 * остановить конвейер на ровном месте.
 */

export type AccountRequirement = {
  /** Слаг сервиса из `controlProps.service`. */
  service: string
  /** Метка учётки — то, что лежит в значении свойства. Пусто — не выбрана. */
  label: string
  /**
   * Чью учётку ждёт свойство. Галочка «показать на сайте» и есть эта развилка:
   * снята — ссылается на нашу, расход наш; стоит — заполняет клиент, расход его.
   */
  clientOwned: boolean
}

export type GateProblem =
  | { code: "no-account-selected"; service: string }
  | { code: "account-missing"; service: string; label: string }
  /**
   * Поле открыто клиенту, но указывает на НАШУ учётку. Не отказ: работать это
   * будет. Но деньги поедут наши там, где предполагались клиентские, и увидеть
   * это надо до того, как придёт счёт.
   */
  | { code: "our-account-on-client-field"; service: string; label: string }

/**
 * Собрать требования по графу.
 *
 * Идём по всему `options.json`, а не по `processingQueue`: свойство учётки
 * живёт в ноде, и ноды, выключенные на этом прогоне, ключа не потребуют — но
 * их отсев уже сделан выше, при сборке очереди шагов.
 */
export function collectRequirements(optionsJson: unknown): AccountRequirement[] {
  const out: AccountRequirement[] = []
  const seen = new Set<string>()

  const walk = (node: unknown, path: string[]): void => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, [...path, String(i)]))
      return
    }
    const obj = node as Record<string, unknown>

    if (obj.controlType === "vendorAccount") {
      const option = readExposedOption(obj, path)
      const service = option?.service ?? ""
      if (option && service) {
        const label = typeof option.value === "string" ? option.value : ""
        // Свойство помечено `exposedToSite` — значит заполняет клиент.
        const clientOwned = obj.exposedToSite === true
        const key = `${service}:${label}:${clientOwned}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push({ service, label, clientOwned })
        }
      }
      return
    }

    for (const [key, child] of Object.entries(obj)) walk(child, [...path, key])
  }

  walk(optionsJson, [])
  return out
}

/**
 * Проверить требования против сейфа.
 *
 * Один запрос на весь граф, а не по свойству: сервисов в графе единицы, но
 * материализация идёт по каждому файлу, и лишний круг запросов здесь заметен.
 */
export async function checkAccounts(input: {
  requirements: AccountRequirement[]
  ownerId: string
}): Promise<GateProblem[]> {
  if (input.requirements.length === 0) return []

  const slugs = [...new Set(input.requirements.map((r) => r.service))]
  let rows: { slug: string; label: string; ownerUserId: string | null }[] = []
  try {
    const result = await query<{
      slug: string
      label: string
      ownerUserId: string | null
    }>(
      `SELECT s.slug, a.label, a.owner_user_id AS "ownerUserId"
         FROM vendor_accounts a
         JOIN vendor_services s ON s.id = a.service_id
        WHERE s.slug = ANY($1::text[])
          AND s.status = 'active'
          AND a.status = 'active'
          -- Либо наша учётка, либо этого владельца. Чужие клиентские в расчёт
          -- не идут вовсе: по ним всё равно ключ не выдадут.
          AND (a.owner_user_id IS NULL OR a.owner_user_id = $2)`,
      [slugs, input.ownerId],
    )
    rows = result.rows
  } catch (error) {
    // Сейфа ещё нет — гейт молчит. Ронять весь проход конвейера из-за
    // непринятой миграции нельзя: к работе машин она отношения не имеет.
    if (isMissingTable(error)) return []
    throw error
  }

  const problems: GateProblem[] = []
  for (const need of input.requirements) {
    if (!need.label) {
      problems.push({ code: "no-account-selected", service: need.service })
      continue
    }
    const found = rows.find(
      (row) => row.slug === need.service && row.label === need.label,
    )
    if (!found) {
      problems.push({
        code: "account-missing",
        service: need.service,
        label: need.label,
      })
      continue
    }
    if (need.clientOwned && found.ownerUserId == null) {
      // Забытый тестовый ключ: поле открыто клиенту, а указывает на нашу
      // учётку. Работать будет, деньги поедут наши — предупреждаем.
      problems.push({
        code: "our-account-on-client-field",
        service: need.service,
        label: need.label,
      })
    }
  }
  return problems
}

/** Отказ, а не предупреждение: по таким проблемам задачу ставить нельзя. */
export function isBlocking(problem: GateProblem): boolean {
  return problem.code !== "our-account-on-client-field"
}
