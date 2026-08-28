/**
 * Проверка навигации админки.
 *
 * «Инструмент есть, но до него не добраться» — это плохой инструмент, и такое
 * уже случалось дважды: разделом, забытым в меню, и страницей выдачи прав,
 * которую нельзя было увидеть, пока ею не воспользуешься. Документацией такое не
 * лечится, поэтому здесь проверка.
 *
 * Реестр — components/admin/shell/nav-config.ts. Сверяем его с файлами страниц:
 *
 *   1. У каждой страницы app/admin/**\/page.tsx есть запись в реестре
 *      (или это хаб области).
 *   2. У каждой записи есть хотя бы одна область — иначе до неё не добраться.
 *   3. Href каждой записи ведёт на существующую страницу.
 *   4. В каждой области есть хотя бы один инструмент.
 *   5. Основная область записи (areas[0]) существует.
 *
 * Запуск: npm run admin:check
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const navConfigPath = join(root, "components/admin/shell/nav-config.ts")
const adminPagesDir = join(root, "app/admin")

/** Страницы админки: путь роута → файл. Группы `(...)` в путях не используются. */
function collectPages(dir, base = "/admin") {
  const pages = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      pages.push(...collectPages(full, `${base}/${entry}`))
    } else if (entry === "page.tsx") {
      pages.push({ route: base, file: relative(root, full) })
    }
  }
  return pages
}

/**
 * Реестр читаем регулярками, а не импортом: файл тянет за собой React и
 * lucide-react, а проверке нужны только строки. Ставить ради неё сборку — дороже
 * самой проверки.
 */
function parseRegistry(source) {
  // Области берём только из своего блока: у инструментов ключи объявлены так же,
  // и общая регулярка тащила бы их в список областей.
  const areasBlock = source.slice(
    source.indexOf("export const ADMIN_AREAS"),
    source.indexOf("export type AdminTool"),
  )
  const areaEntries = [
    ...areasBlock.matchAll(
      /key:\s*"([a-z-]+)",\s*\n\s*labelKey:[\s\S]*?href:\s*"([^"]+)"/g,
    ),
  ].map((m) => ({ key: m[1], href: m[2] }))
  const areas = areaEntries.map((entry) => entry.key)

  const tools = []
  const toolBlocks = source
    .slice(source.indexOf("export const ADMIN_TOOLS"))
    .split(/\n {2}\{\n/)
    .slice(1)

  for (const block of toolBlocks) {
    const key = block.match(/key:\s*"([^"]+)"/)?.[1]
    const href = block.match(/href:\s*"([^"]+)"/)?.[1]
    const areasRaw = block.match(/areas:\s*\[([^\]]*)\]/)?.[1] ?? ""
    if (!key || !href) continue
    tools.push({
      key,
      href,
      areas: [...areasRaw.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]),
      isAreaHub: /isAreaHub:\s*true/.test(block),
    })
  }
  return { areas, areaEntries, tools }
}

const source = readFileSync(navConfigPath, "utf8")
const { areas, areaEntries, tools } = parseRegistry(source)
const pages = collectPages(adminPagesDir)

const problems = []

if (tools.length === 0) {
  problems.push("Реестр ADMIN_TOOLS пуст — регулярка разошлась с файлом.")
}

const hrefs = new Set(tools.map((tool) => tool.href))
const areaHubs = new Set(
  [...source.matchAll(/href:\s*"([^"]+)",\s*\n\s*icon:[^\n]*\n\s*(standalone|\})/g)].map(
    (m) => m[1],
  ),
)

// 1. Страница без записи в реестре — раздел, до которого никак не добраться.
for (const page of pages) {
  if (hrefs.has(page.route)) continue
  if (areaHubs.has(page.route)) continue
  // Хабы областей: /admin/insights, /admin/access — записи инструмента у них нет.
  if (areas.some((area) => page.route === `/admin/${area}`)) continue
  // Вложенная страница зарегистрированного раздела: до неё добираются изнутри
  // него (как до /admin/remote-access/api из /admin/remote-access). Проверка
  // ручается за верхний уровень; что у раздела внутри — его дело.
  if ([...hrefs].some((href) => page.route.startsWith(`${href}/`))) continue
  problems.push(
    `${page.file}: страницы нет в ADMIN_TOOLS — до неё не добраться из меню. ` +
      `Добавьте запись в components/admin/shell/nav-config.ts.`,
  )
}

// 2–3. Записи без области и записи в никуда.
const routes = new Set(pages.map((page) => page.route))
for (const tool of tools) {
  if (tool.areas.length === 0) {
    problems.push(`ADMIN_TOOLS["${tool.key}"]: нет ни одной области.`)
  }
  for (const area of tool.areas) {
    if (!areas.includes(area)) {
      problems.push(
        `ADMIN_TOOLS["${tool.key}"]: область "${area}" не объявлена в ADMIN_AREAS.`,
      )
    }
  }
  if (!routes.has(tool.href)) {
    problems.push(
      `ADMIN_TOOLS["${tool.key}"]: href "${tool.href}" — страницы нет.`,
    )
  }
}

// 4. Пустая область — строка в меню, за которой ничего.
for (const area of areas) {
  if (!tools.some((tool) => tool.areas.includes(area))) {
    problems.push(`ADMIN_AREAS["${area}"]: в области нет ни одного инструмента.`)
  }
}

// 5. Главная страница области должна показывать ВСЕ её инструменты.
//
// Ровно та ошибка, ради которой правило и появилось: `/admin` вёл на «Обзор»,
// то есть на первый инструмент области, а не на её список. В упрощённом виде,
// где колонки инструментов нет, это единственный способ узнать, что в области
// вообще есть, — и человек его не получал.
//
// Исключение допустимо, когда у области ровно один «свой» инструмент: список из
// одной карточки хуже, чем прямая ссылка. Так живёт конвейер.
for (const area of areaEntries) {
  const own = tools.filter((tool) => tool.areas[0] === area.key)
  const toolAtHref = tools.find((tool) => tool.href === area.href)
  if (!toolAtHref) continue

  if (own.length > 1) {
    problems.push(
      `ADMIN_AREAS["${area.key}"]: href "${area.href}" ведёт на инструмент ` +
        `"${toolAtHref.key}", а в области их ${own.length}. Нажав на область, ` +
        `человек попадёт в первый раздел вместо списка. Сделайте по этому ` +
        `адресу хаб (<AdminHub area="${area.key}" />), а инструмент перенесите.`,
    )
  } else if (!toolAtHref.isAreaHub) {
    problems.push(
      `ADMIN_TOOLS["${toolAtHref.key}"]: стоит на href области ` +
        `"${area.key}" — пометьте его isAreaHub: true, чтобы он не дублировался ` +
        `в карточках и крошках.`,
    )
  }
}

if (problems.length > 0) {
  console.error("admin: навигация не сходится\n")
  for (const problem of problems) console.error(`  • ${problem}`)
  console.error(
    `\n${problems.length} проблем(ы). Реестр: components/admin/shell/nav-config.ts`,
  )
  process.exit(1)
}

console.log(
  `admin: навигация в порядке — ${tools.length} инструмент(ов), ` +
    `${areas.length} област(и), ${pages.length} страниц(ы).`,
)
