/**
 * Сырьё титров в папке дорожки — поиск по языку в имени файла.
 *
 * Контракт (§8 DIALOG_FORMAT.md) называет файлы `orig.srt` и `{lang}.srt`, но в
 * жизни обработка кладёт в папку дорожки то имя, которое ей досталось:
 * `original.srt`, `dialog_rus.srt`, `speaker_01_eng.srt`. Точное имя поэтому —
 * первая попытка, а не единственная: не сошлось — язык ищется **в самом имени**.
 *
 * Почему не «единственный .srt в папке — он и нужный»: в папке дорожки лежат и
 * оригинал, и переводы, и перепутать их значит молча подставить не тот текст в
 * восстановление. Отдать чужой файл хуже, чем не отдать никакого, поэтому
 * перевод берётся только по названному языку, и никогда — наугад.
 *
 * Предел правила: язык должен быть отдельным куском имени, отбитым `-`, `_`,
 * `.` или пробелом. `dialogRUS.srt` не распознаётся — по нему нельзя отличить
 * язык от хвоста слова, и попытка угадать давала бы ложные совпадения.
 */

/** Что ищем в папке дорожки. */
export type SrtWant =
  /** Оригинал: машинное распознавание речи. */
  | { kind: "original"; lang: string | null }
  /** Перевод на названный язык. */
  | { kind: "lang"; lang: string }

/**
 * Слова, которыми называют оригинал. Язык оригинала в имени тоже бывает, но
 * он вторая догадка: `original.srt` рядом с `..._eng.srt` — это один и тот же
 * файл только в том случае, когда второго нет.
 */
const ORIGINAL_TOKENS = new Set([
  "orig",
  "original",
  "originals",
  "source",
  "src",
  "ориг",
  "оригинал",
  "исходник",
])

/**
 * Как язык называют в именах файлов: код, трёхбуквенный, слово, по-русски.
 *
 * Список не «все языки мира», а те, с которыми работает обработка; для
 * остального работает общее правило — двухбуквенный код языка как отдельный
 * кусок имени. Дополнять таблицу здесь безопасно: она ни на что, кроме поиска
 * файла, не влияет.
 */
const LANG_ALIASES: Record<string, string[]> = {
  ru: ["rus", "russian", "рус", "русский"],
  en: ["eng", "english", "англ", "английский"],
  es: ["spa", "esp", "spanish", "исп", "испанский"],
  fr: ["fra", "fre", "french", "фр", "фра", "французский"],
  de: ["deu", "ger", "german", "нем", "немецкий"],
  it: ["ita", "italian", "итал", "итальянский"],
  pt: ["por", "portuguese", "порт", "португальский"],
  pl: ["pol", "polish", "пол", "польский"],
  tr: ["tur", "turkish", "тур", "турецкий"],
  uk: ["ukr", "ukrainian", "укр", "украинский"],
  kk: ["kaz", "kazakh", "каз", "казахский"],
  zh: ["zho", "chi", "chinese", "кит", "китайский"],
  ja: ["jpn", "japanese", "яп", "японский"],
  ko: ["kor", "korean", "кор", "корейский"],
  ar: ["ara", "arabic", "араб", "арабский"],
  hi: ["hin", "hindi", "хинди"],
  he: ["heb", "hebrew", "иврит"],
  nl: ["nld", "dut", "dutch"],
  sv: ["swe", "swedish"],
  vi: ["vie", "vietnamese"],
  th: ["tha", "thai"],
  id: ["ind", "indonesian"],
}

/** Имя без расширения, разобранное на куски: `dialog_01-rus.srt` → dialog, 01, rus. */
function tokensOf(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * Как язык может называться в имени: сам код, его регион и все синонимы.
 *
 * `pt-BR` даёт и `ptbr`, и `pt`: файл с регионом в имени точнее, но файл без
 * него — тот же язык, и не взять его было бы хуже.
 */
function aliasesOf(lang: string): { exact: Set<string>; base: Set<string> } {
  const code = lang.trim().toLowerCase()
  const base = code.split(/[-_]/)[0] ?? code
  const exact = new Set([code, code.replace(/[-_]/g, "")])
  const wide = new Set([base, ...(LANG_ALIASES[base] ?? [])])
  return { exact, base: wide }
}

/** Назван ли в имени файла именно этот язык. */
export function nameHasLang(name: string, lang: string): boolean {
  const tokens = tokensOf(name)
  const { exact, base } = aliasesOf(lang)
  return tokens.some((token) => exact.has(token) || base.has(token))
}

/** Назван ли файл оригиналом — словом, а не языком. */
export function nameIsOriginal(name: string): boolean {
  return tokensOf(name).some((token) => ORIGINAL_TOKENS.has(token))
}

/**
 * Выбрать файл титров из папки дорожки.
 *
 * Порядок предпочтений и есть смысл функции:
 *
 * - **оригинал** — сперва названный словом (`original`), потом названный своим
 *   языком (`..._eng` при `languages.original: "en"`), и лишь если в папке
 *   ровно один `.srt` — он. Один файл в папке дорожки не с чем перепутать;
 * - **перевод** — только по названному языку. Файл, названный оригиналом, не
 *   берётся никогда, даже когда язык совпал: `original_rus.srt` при переводе на
 *   русский — это исходник, а не перевод.
 *
 * Совпало несколько — берётся более точное (с регионом), дальше по имени:
 * выбор не должен зависеть от порядка строк каталога.
 */
export function pickSrtName(names: string[], want: SrtWant): string | null {
  const srt = names.filter((name) => /\.srt$/i.test(name))
  if (srt.length === 0) return null

  const byName = (a: string, b: string) => a.localeCompare(b)
  const ranked = (candidates: { name: string; rank: number }[]) =>
    candidates.sort((a, b) => a.rank - b.rank || byName(a.name, b.name))[0]?.name ?? null

  if (want.kind === "original") {
    const named = srt.filter(nameIsOriginal).sort(byName)[0]
    if (named) return named
    const lang = want.lang
    if (lang) {
      const byLang = srt.filter((name) => nameHasLang(name, lang)).sort(byName)[0]
      if (byLang) return byLang
    }
    return srt.length === 1 ? srt[0]! : null
  }

  const { exact } = aliasesOf(want.lang)
  const candidates = srt
    .filter((name) => !nameIsOriginal(name) && nameHasLang(name, want.lang))
    .map((name) => ({
      name,
      rank: tokensOf(name).some((token) => exact.has(token)) ? 0 : 1,
    }))
  return ranked(candidates)
}

/**
 * Какой язык назван в имени файла — обратный поиск по той же таблице.
 *
 * Нужен сборке документа: там языки не спрашивают, а **находят** — что в папке
 * дорожки лежит, то и есть список переводов задачи. Возвращается всегда
 * двухбуквенный код: `dialog_RUS.srt` и `dialog_ru.srt` — один и тот же язык, и
 * двумя колонками перевода они быть не должны.
 *
 * Имя, названное оригиналом словом, языка не даёт: `original.srt` — это
 * исходник, даже если рядом в имени мелькает код.
 */
export function langFromName(name: string): string | null {
  if (nameIsOriginal(name)) return null
  const tokens = tokensOf(name)
  for (const token of tokens) {
    if (LANG_ALIASES[token]) return token
    for (const [code, aliases] of Object.entries(LANG_ALIASES)) {
      if (aliases.includes(token)) return code
    }
  }
  // Двухбуквенный код языка, которого нет в таблице: берём как есть — список
  // там не «все языки мира», а те, что встречались.
  const last = tokens[tokens.length - 1]
  return last && /^[a-z]{2}$/.test(last) ? last : null
}

/**
 * Что означает путь, который просят: оригинал или перевод.
 *
 * Пути приходят от `sourcePathsFor` (`01/orig.srt`, `01/ru.srt`) и из
 * `cue.origin.file` — там имя может быть любым. Не разобрали — значит искать
 * подбором нечего: точное имя уже не нашлось, а гадать по чужому имени не о чем.
 */
export function wantFromSourcePath(
  relative: string,
  originalLang: string | null,
): SrtWant | null {
  const file = relative.slice(relative.lastIndexOf("/") + 1)
  if (nameIsOriginal(file)) return { kind: "original", lang: originalLang }
  const base = file.replace(/\.[^.]+$/, "").toLowerCase()
  if (!base) return null
  if (originalLang && nameHasLang(file, originalLang)) {
    return { kind: "original", lang: originalLang }
  }
  // Путь вида `{lang}.srt` — так их строит sourcePathsFor. Всё остальное —
  // имя из `origin.file`, и языка в нём мы не знаем.
  return /^[a-z]{2,3}([-_][a-z0-9]{2,4})?$/i.test(base) ? { kind: "lang", lang: base } : null
}
