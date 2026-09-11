/**
 * Ищет захардкоженный цвет в локализуемых зонах интерфейса.
 *
 * Правило — docs/UI_GUIDE.md §4 и docs/UI_TOKENS.md: цвет задаётся только
 * токеном или производной от него утилитой. Одного правила мало: экраны
 * кабинета были свёрстаны от макета в обход токенов и прошли ревью, потому что
 * рядом лежали такие же файлы.
 *
 * Без этой проверки светлая тема не живёт: переключатель меняет ЗНАЧЕНИЯ
 * переменных, а на `text-[#eef1f6]` он не действует вовсе — на светлом фоне
 * останется почти белый текст (docs/THEMING_PLAN.md §2).
 *
 * Что считается нарушением: `text-[#eef1f6]`, `bg-[rgba(45,131,206,0.16)]`,
 * `bg-[hsl(226_28%_9%)]` — литеральный цвет в классе.
 *
 * НЕ нарушение:
 *   * `bg-[hsl(var(--surface-2))]` — тот же токен, просто записанный длинно:
 *     тема меняет его значение и здесь;
 *   * тени и нейтральные оверлеи (`bg-white/5`, `border-white/10`) — это не
 *     цвет бренда, а подсветка поверхности; их разбирает этап светлой темы
 *     (docs/THEMING_PLAN.md §4.3).
 *
 * Запуск: npm run color:check
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, dirname, relative } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const ZONES = ["components", "app"]

/**
 * Осознанные исключения. Каждое — с причиной: список не «то, до чего не дошли
 * руки», а решения, которые проверка не должна отменять молча.
 */
const EXCEPTIONS = new Map([
  [
    "components/admin/pipeline/task-steps.tsx",
    "порт STEP_COLOR из LOG_WIN/utils.ts: цвета шагов совпадают с десктопной программой значение в значение",
  ],
  [
    "components/account/tools/voice/cue-list.tsx",
    "палитра редактора озвучки: своё решение, отдельно от токенов сайта",
  ],
  [
    "components/account/tools/voice/timeline-pane.tsx",
    "палитра редактора озвучки",
  ],
  [
    "components/account/tools/voice/export-dialog.tsx",
    "палитра редактора озвучки",
  ],
  [
    "components/account/tools/srt/timeline-pane.tsx",
    "палитра редактора титров",
  ],
  [
    "components/account/tools/shared/save-badge.tsx",
    "палитра редакторов: значок несохранённого",
  ],
])

const COLOR = /[a-z][a-z-]*-\[(#[0-9a-fA-F]{3,8}|rgba?\([^\]]*\)|hsl\([^\]]*\))\]/g

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx$/.test(name)) out.push(full)
  }
  return out
}

let violations = 0
let allowed = 0
for (const zone of ZONES) {
  for (const file of walk(join(root, zone))) {
    const rel = relative(root, file)
    const text = readFileSync(file, "utf8")
    // `var(--token)` внутри значения — это токен, а не хардкод.
    const hits = [...text.matchAll(COLOR)].filter(
      (hit) => !hit[0].includes("var(--"),
    )
    if (hits.length === 0) continue
    if (EXCEPTIONS.has(rel)) {
      allowed += hits.length
      continue
    }
    violations += hits.length
    const lines = text.split("\n")
    for (const hit of hits) {
      const line = text.slice(0, hit.index).split("\n").length
      console.error(`${rel}:${line}  ${hit[0]}`)
      void lines
    }
  }
}

if (violations > 0) {
  console.error(
    `\ncolor: захардкоженного цвета — ${violations}. Замена берётся из таблицы docs/UI_TOKENS.md §11, а не подбирается на глаз.`,
  )
  process.exit(1)
}
console.log(`color: хардкода нет (в исключениях — ${allowed}, причины в scripts/color-check.mjs).`)
