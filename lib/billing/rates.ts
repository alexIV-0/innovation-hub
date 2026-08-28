import { VENDOR_CURRENCIES } from "@/lib/billing/types"
import { query } from "@/lib/db"

/**
 * Курс валюты себестоимости к рублю.
 *
 * Нужен ровно в одном месте: плагин отдаёт цену внешнего сервиса в долларах
 * (`costUsd`), а списываем мы рубли с внутреннего баланса. Банк в этой операции
 * не участвует вообще — он участвовал раньше, когда с карты платили сервису.
 *
 * Курс не назначаем, а БЕРЁМ: ЦБ РФ, один запрос в сутки. Своим курсом торгуют
 * обменники. Поправка на то, что реальная конвертация по карте дороже биржевой,
 * живёт отдельным процентом в настройках (`fxAdjustPct`) — это не курс.
 *
 * Главное здесь не источник, а то, что применённый курс уезжает в транзакцию
 * (lib/billing/ledger.ts): после списания он не пересчитывается никогда.
 */

const CBR_URL = "https://www.cbr.ru/scripts/XML_daily.asp"
const FETCH_TIMEOUT_MS = 10_000

export type CurrencyRate = {
  currency: string
  rateDay: string
  rate: number
  source: string
}

/**
 * Последний известный курс на дату не позже сегодняшней.
 *
 * Не «на сегодня»: у ЦБ нет курсов на выходные и праздники, и требование точной
 * даты остановило бы биллинг на каждые новогодние каникулы.
 */
export async function readLatestRate(
  currency: string,
): Promise<CurrencyRate | null> {
  const result = await query<{
    currency: string
    rateDay: string
    rate: string
    source: string
  }>(
    `SELECT currency,
            to_char(rate_day, 'YYYY-MM-DD') AS "rateDay",
            rate::text AS rate,
            source
       FROM currency_rates
      WHERE currency = $1
        AND rate_day <= CURRENT_DATE
      ORDER BY rate_day DESC
      LIMIT 1`,
    [currency.toUpperCase()],
  )
  const row = result.rows[0]
  if (!row) return null
  return { ...row, rate: Number(row.rate) }
}

export async function saveRate(input: CurrencyRate): Promise<void> {
  await query(
    `INSERT INTO currency_rates (currency, rate_day, rate, source, fetched_at)
     VALUES ($1, $2::date, $3, $4, NOW())
     ON CONFLICT (currency, rate_day)
     DO UPDATE SET rate = EXCLUDED.rate,
                   source = EXCLUDED.source,
                   fetched_at = NOW()`,
    [input.currency.toUpperCase(), input.rateDay, input.rate, input.source],
  )
}

/**
 * Разбор ответа ЦБ без XML-парсера.
 *
 * Формат стабилен десятилетиями и предельно прост, а тянуть зависимость ради
 * одного запроса в сутки дороже, чем два регулярных выражения. Важная деталь:
 * `Value` приходит с запятой (`91,2345`), а `Nominal` бывает не единицей —
 * у иены, например, сто. Пропустить второе значит ошибиться в сто раз и не
 * заметить: число всё равно правдоподобное.
 */
export function parseCbrXml(xml: string): CurrencyRate[] {
  const dateMatch = /Date="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml)
  const rateDay = dateMatch
    ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`
    : new Date().toISOString().slice(0, 10)

  const out: CurrencyRate[] = []
  const valute = /<Valute[^>]*>([\s\S]*?)<\/Valute>/g
  let block: RegExpExecArray | null
  while ((block = valute.exec(xml)) !== null) {
    const body = block[1]!
    const code = /<CharCode>([^<]+)<\/CharCode>/.exec(body)?.[1]?.trim()
    const nominalRaw = /<Nominal>([^<]+)<\/Nominal>/.exec(body)?.[1]?.trim()
    const valueRaw = /<Value>([^<]+)<\/Value>/.exec(body)?.[1]?.trim()
    if (!code || !valueRaw) continue

    const nominal = Number(nominalRaw?.replace(",", ".") ?? "1") || 1
    const value = Number(valueRaw.replace(",", "."))
    if (!Number.isFinite(value) || value <= 0) continue

    out.push({
      currency: code.toUpperCase(),
      rateDay,
      // Приводим к цене ОДНОЙ единицы валюты, иначе иена уедет в сто раз мимо.
      rate: value / nominal,
      source: "cbr",
    })
  }
  return out
}

export type RefreshResult = {
  fetched: number
  saved: number
  rateDay: string | null
  error: string | null
}

/**
 * Забрать курсы у ЦБ и сохранить. Зовётся часовым тиком статистики — попадание
 * несколько раз в сутки безвредно: строка за день перезаписывается.
 *
 * Ошибка сети не бросается наверх: биллинг обязан продолжать работать на
 * последнем известном курсе. Остановить списания из-за недоступного cbr.ru было
 * бы хуже, чем посчитать по вчерашнему курсу.
 */
export async function refreshRatesFromCbr(
  currencies: readonly string[] = VENDOR_CURRENCIES,
): Promise<RefreshResult> {
  const wanted = new Set(currencies.map((c) => c.toUpperCase()))
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let xml: string
    try {
      const res = await fetch(CBR_URL, { signal: controller.signal })
      if (!res.ok) {
        return { fetched: 0, saved: 0, rateDay: null, error: `HTTP ${res.status}` }
      }
      // Ответ в windows-1251; коды валют и числа — ASCII, поэтому декодирование
      // как utf-8 их не портит, а кириллические названия нам не нужны.
      xml = await res.text()
    } finally {
      clearTimeout(timer)
    }

    const parsed = parseCbrXml(xml)
    const picked = parsed.filter((r) => wanted.has(r.currency))
    for (const rate of picked) {
      await saveRate(rate)
    }
    return {
      fetched: parsed.length,
      saved: picked.length,
      rateDay: picked[0]?.rateDay ?? null,
      error: null,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[billing] не удалось обновить курсы ЦБ", message)
    return { fetched: 0, saved: 0, rateDay: null, error: message }
  }
}
