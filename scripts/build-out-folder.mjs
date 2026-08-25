#!/usr/bin/env node
/**
 * Собирает папку `OUT` целиком — такую, какой она должна быть после обработки:
 * по папке-задаче на каждый исходник, внутри — документ, исходник, волна и сырьё
 * титров. Это то, что инструмент подтягивает через каскадное меню
 * (docs/TOOLS_SRT_EDITOR_PLAN.md §6, раскладка — §8).
 *
 *   node scripts/build-out-folder.mjs --dub <DUB> --videos <dir> --out <dir> \
 *        [--stems all|none|<Имя,Имя>] [--no-stems <Имя,Имя>] [--only <Имя,Имя>]
 *
 * Стемы (аудио по персонажам) редактору не обязательны: дорожка — это титры.
 * Но в раскладке они предусмотрены, поэтому по умолчанию кладём их везде, кроме
 * перечисленных в --no-stems: так в папке есть и задачи с аудио на дорожках, и
 * задачи только с титрами.
 *
 * Источник данных — проекты Cast Analyzer (docs/TOOLS_SRT_EDITOR_PLAN.md §V.8).
 * Это временный мост: в конвейере ту же папку соберёт нода `dialogDocBuild`,
 * и раскладка обязана получиться такой же.
 */

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

import { importProject } from "./import-castanalyzer.mjs"

function args() {
  const a = process.argv.slice(2)
  const get = (n) => {
    const i = a.indexOf(`--${n}`)
    return i >= 0 ? a[i + 1] : null
  }
  const dub = get("dub")
  const out = get("out")
  if (!dub || !out) {
    console.error(
      "Использование: node scripts/build-out-folder.mjs --dub <DUB> --videos <dir> " +
        "--out <dir> [--stems <ИмяЗадачи>] [--only <Имя,Имя>]",
    )
    process.exit(2)
  }
  const list = (v) => (v ? v.split(",").map((x) => x.trim()).filter(Boolean) : null)
  return {
    dub: path.resolve(dub),
    videos: get("videos") ? path.resolve(get("videos")) : null,
    out: path.resolve(out),
    stems: get("stems") ?? "all",
    noStems: list(get("no-stems")) ?? [],
    only: list(get("only")),
  }
}

/** Кому кладём стемы: `all` минус исключения, `none`, либо явный список. */
function wantsStems(name, opt) {
  if (opt.noStems.includes(name)) return false
  if (opt.stems === "all") return true
  if (opt.stems === "none") return false
  return opt.stems.split(",").map((s) => s.trim()).includes(name)
}

const fmtMs = (ms) => {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function readme(rows, opt) {
  const withoutStems = rows.filter((r) => !r.stems).map((r) => r.name)
  const lines = rows
    .map(
      (r) =>
        `| \`${r.name}/\` | ${fmtMs(r.durationMs)} | ${r.tracks} | ${r.cues} | ${r.review} | ${r.unknown} | ${r.stems ? "да" : "нет"} |`,
    )
    .join("\n")
  return `# OUT — папка результатов обработки

Так папка \`OUT\` должна выглядеть после автоматизации. Именно её подтягивает инструмент
работы с титрами: в каскадном меню выбирается проект, затем папка-задача из этого списка.

Собрано скриптом \`scripts/build-out-folder.mjs\` из проектов Cast Analyzer. В конвейере ту же
папку собирает нода \`dialogDocBuild\` — раскладка обязана получиться такой же.

## Задачи

| задача | длительность | дорожек | реплик | на проверку | не распознано | стемы |
|---|---:|---:|---:|---:|---:|:---:|
${lines}

## Что внутри задачи

\`\`\`
{задача}/
  dialog.json          источник правды: дорожки (персонажи), реплики, правила
  source.mp4           исходник: кадр и общий звук
  mix.peaks.json       волна общего звука — её рисует таймлиния на каждой дорожке
  00/orig.srt          сырьё титров: «не распознано» (если такие реплики есть)
  01/orig.srt          сырьё титров персонажа
  02/orig.srt
  …
\`\`\`

Формат документа и все правила работы с ним — \`docs/DIALOG_FORMAT.md\`.
Проверка: \`node scripts/check-dialog-doc.mjs <эта папка>\`.

## Чего здесь намеренно нет

| чего нет | почему |
|---|---|
| переводов (\`es.srt\`, \`fr.srt\`) | их добавляет следующий шаг конвейера. \`languages.targets\` пустой — инструмент обязан работать и так, без колонок перевода |
| своего аудио у дорожек — **не везде** | редактору стемы не нужны: дорожка это титры персонажа, а звук нужен один, общий. Там, где стемы есть, дорожка рисует свою волну; где нет — общую, приглушённо. Обе ситуации в папке представлены (колонка «стемы» выше)${
    withoutStems.length ? `: только титры у ${withoutStems.map((n) => `\`${n}\``).join(", ")}` : ""
  } |
| папки \`exports/\` | её создаёт инструмент при первом экспорте |
| промежуточных файлов разбора | они остаются в локальной рабочей папке обработки и вычищаются через несколько дней |

## Пересобрать

\`\`\`bash
node scripts/build-out-folder.mjs --dub <DUB> --videos <папка с видео> --out <эта папка>${
    opt.stems ? ` \\
     --stems "${opt.stems}"` : ""
  }
\`\`\`
`
}

async function main() {
  const opt = args()

  const names = []
  for (const name of (await readdir(opt.dub)).sort()) {
    const dir = path.join(opt.dub, name)
    if (!(await stat(dir)).isDirectory()) continue
    if (!existsSync(path.join(dir, "project.json"))) continue
    if (opt.only && !opt.only.includes(name)) continue
    names.push(name)
  }
  if (!names.length) {
    console.error(`В ${opt.dub} не нашёл ни одного проекта (папки с project.json)`)
    process.exit(2)
  }

  await rm(opt.out, { recursive: true, force: true })
  await mkdir(opt.out, { recursive: true })

  const rows = []
  for (const name of names) {
    const video = opt.videos ? path.join(opt.videos, `${name}.mp4`) : null
    if (video && !existsSync(video)) {
      console.log(`  ! ${name}: видео не найдено (${path.basename(video)}), собираю без него`)
    }
    const withStems = wantsStems(name, opt)
    process.stdout.write(`  … ${name}${withStems ? " (со стемами)" : ""}`)
    const r = await importProject({
      project: path.join(opt.dub, name),
      video: video && existsSync(video) ? video : null,
      out: path.join(opt.out, name),
      stems: withStems,
      pps: 50,
      quiet: true,
    })
    rows.push({ name, stems: withStems, ...r })
    process.stdout.write(
      `\r  ✓ ${name.padEnd(20)} дорожек ${String(r.tracks).padStart(2)}  ` +
        `реплик ${String(r.cues).padStart(3)}  на проверку ${String(r.review).padStart(2)}  ` +
        `не распознано ${r.unknown}${withStems ? "  + стемы" : ""}\n`,
    )
    for (const p of r.problems) console.log(`      • ${p}`)
  }

  await writeFile(path.join(opt.out, "README.md"), readme(rows, opt))
  console.log(`\n  ✓ README.md — структура и что в ней есть`)
  console.log(`\nГотово: ${opt.out} — задач ${rows.length}`)
  console.log(`Проверить: node scripts/check-dialog-doc.mjs "${opt.out}"`)
}

main().catch((e) => {
  console.error(`Не собралось: ${e.message}`)
  process.exit(1)
})
