#!/usr/bin/env node
/**
 * Проверка документа `dialog.json` по контракту docs/DIALOG_FORMAT.md.
 *
 *   node scripts/check-dialog-doc.mjs <файл|папка> [ещё...]
 *
 * Порядок проверок — из §6 контракта, чтобы обе реализации ругались на одно и то
 * же. Отдельно проверяется правило §2.4 (детерминированный порядок) и §10
 * («открыл → сохранил → файл побайтово тот же»).
 *
 * Различаем **ошибки** (файл невалиден, открывать нельзя) и **замечания**
 * (нарушены правила материала — показать человеку, но не отказывать: §5).
 */

import { readFile, readdir, stat } from "node:fs/promises"
import path from "node:path"

const errors = []
const warns = []
const err = (f, m) => errors.push(`${f}: ${m}`)
const warn = (f, m) => warns.push(`${f}: ${m}`)

const BAD_PATH = /^(\/|[a-zA-Z]:|.*\.\.)/

function checkPath(file, label, value) {
  if (value == null) return
  if (typeof value !== "string" || BAD_PATH.test(value)) {
    err(file, `${label}: путь должен быть относительным и без "..", получено ${JSON.stringify(value)}`)
  }
}

function checkDoc(file, raw) {
  let doc
  try {
    doc = JSON.parse(raw)
  } catch (e) {
    err(file, `не разбирается как JSON: ${e.message}`)
    return null
  }

  // §6.1–6.2 — свой ли файл и знаем ли версию
  if (doc.format !== "dialogDoc") return err(file, `format должен быть "dialogDoc", а не ${JSON.stringify(doc.format)}`), null
  if (doc.version !== 1) return err(file, `неизвестная версия документа: ${doc.version}`), null
  for (const key of ["id", "revision"]) {
    if (doc[key] == null) err(file, `нет обязательного поля ${key}`)
  }
  if (!doc.media || typeof doc.media.durationMs !== "number") err(file, "нет media.durationMs")
  if (!doc.languages?.original) err(file, "нет languages.original")

  // §6.3 — пути
  checkPath(file, "media.video", doc.media?.video)
  checkPath(file, "media.mix", doc.media?.mix)
  checkPath(file, "media.peaks", doc.media?.peaks)

  // §6.4 — дорожки
  const trackIds = new Set()
  const nos = new Set()
  for (const t of doc.tracks ?? []) {
    if (trackIds.has(t.id)) err(file, `дорожка ${t.id} встречается дважды`)
    if (nos.has(t.no)) err(file, `номер дорожки ${t.no} встречается дважды`)
    trackIds.add(t.id)
    nos.add(t.no)
    checkPath(file, `${t.id}.audio`, t.audio)
    checkPath(file, `${t.id}.peaks`, t.peaks)
  }

  // §6.5–6.6 — реплики
  const cueIds = new Set()
  const rules = { minDurationMs: 250, maxCps: 25, maxTranslationRatio: 1.2, ...(doc.rules ?? {}) }
  let short = 0
  let beyond = 0
  let empty = 0
  let highCps = 0
  const longTr = []
  for (const c of doc.cues ?? []) {
    if (cueIds.has(c.id)) err(file, `реплика ${c.id} встречается дважды`)
    cueIds.add(c.id)
    if (!trackIds.has(c.trackId)) err(file, `реплика ${c.id} ссылается на несуществующую дорожку ${c.trackId}`)
    if (!(Number.isInteger(c.startMs) && Number.isInteger(c.endMs))) {
      err(file, `реплика ${c.id}: тайминги должны быть целыми миллисекундами`)
      continue
    }
    if (c.startMs < 0 || c.endMs <= c.startMs) err(file, `реплика ${c.id}: некорректный интервал ${c.startMs}–${c.endMs}`)
    if (c.endMs > (doc.media?.durationMs ?? Infinity)) beyond += 1
    if (c.endMs - c.startMs < rules.minDurationMs) short += 1
    if (!c.text) empty += 1
    else if ((c.text.length / ((c.endMs - c.startMs) / 1000)) > rules.maxCps) highCps += 1
    for (const [lang, tr] of Object.entries(c.tr ?? {})) {
      const ratio = c.text ? (tr?.text?.length ?? 0) / c.text.length : 0
      if (ratio > rules.maxTranslationRatio) longTr.push(`${c.id}/${lang}`)
    }
    // §6.7 — язык не из списка не ошибка, но должен сохраняться
    for (const lang of Object.keys(c.tr ?? {})) {
      if (!(doc.languages?.targets ?? []).includes(lang)) {
        warn(file, `реплика ${c.id}: перевод на "${lang}", которого нет в languages.targets (сохраняем, не показываем)`)
      }
    }
  }

  // §2.4 — детерминированный порядок
  const cues = doc.cues ?? []
  for (let i = 1; i < cues.length; i += 1) {
    const a = cues[i - 1]
    const b = cues[i]
    const cmp =
      a.startMs - b.startMs || String(a.trackId).localeCompare(b.trackId) || String(a.id).localeCompare(b.id)
    if (cmp > 0) {
      err(file, `порядок реплик нарушен на ${b.id} (правило §2.4: startMs, затем trackId, затем id)`)
      break
    }
  }

  // §5 — правила материала: замечания, не ошибки
  if (short) warn(file, `реплик короче ${rules.minDurationMs} мс: ${short}`)
  if (beyond) warn(file, `реплик за пределами media.durationMs: ${beyond}`)
  if (empty) warn(file, `реплик без текста: ${empty}`)
  if (highCps) warn(file, `реплик выше ${rules.maxCps} CPS: ${highCps}`)
  if (longTr.length) {
    warn(file, `переводов длиннее оригинала более чем в ${rules.maxTranslationRatio}×: ${longTr.length} (${longTr.slice(0, 3).join(", ")}${longTr.length > 3 ? ", …" : ""})`)
  }
  let overlaps = 0
  for (const id of trackIds) {
    const own = cues.filter((c) => c.trackId === id)
    for (let i = 1; i < own.length; i += 1) if (own[i].startMs < own[i - 1].endMs) overlaps += 1
  }
  if (overlaps && (doc.rules?.overlapWithinTrack ?? "forbid") === "forbid") {
    warn(file, `пересечений внутри дорожки: ${overlaps}, при rules.overlapWithinTrack = "forbid"`)
  }

  // §10 — «открыл → сохранил → тот же файл»
  const again = `${JSON.stringify(doc, null, 2)}\n`
  if (again !== raw) {
    warn(file, "перезапись даёт другие байты (отступы, порядок ключей или перевод строки в конце)")
  }

  return doc
}

async function collect(target) {
  const st = await stat(target)
  if (st.isFile()) return [target]
  const out = []
  for (const name of await readdir(target)) {
    const p = path.join(target, name)
    const s = await stat(p)
    if (s.isDirectory()) out.push(...(await collect(p)))
    else if (name === "dialog.json") out.push(p)
  }
  return out
}

async function main() {
  const targets = process.argv.slice(2)
  if (!targets.length) {
    console.error("Использование: node scripts/check-dialog-doc.mjs <файл|папка> [...]")
    process.exit(2)
  }
  const files = (await Promise.all(targets.map(collect))).flat()
  if (!files.length) {
    console.error("Не нашёл ни одного dialog.json")
    process.exit(2)
  }

  for (const f of files) {
    const raw = await readFile(f, "utf8")
    const doc = checkDoc(path.basename(path.dirname(f)), raw)
    if (doc) {
      const review = (doc.cues ?? []).filter((c) => c.origin?.needsReview).length
      const unknown = (doc.cues ?? []).filter((c) => c.trackId === "t00").length
      console.log(
        `  ${path.basename(path.dirname(f)).padEnd(20)} ` +
          `дорожек ${String(doc.tracks?.length ?? 0).padStart(2)}  ` +
          `реплик ${String(doc.cues?.length ?? 0).padStart(3)}  ` +
          `на проверку ${String(review).padStart(2)}  не распознано ${unknown}`,
      )
    }
  }

  if (warns.length) {
    console.log(`\nЗамечания (${warns.length}) — показать человеку, но открывать можно:`)
    for (const w of warns) console.log(`  • ${w}`)
  }
  if (errors.length) {
    console.log(`\nОшибки (${errors.length}) — такой документ открывать нельзя:`)
    for (const e of errors) console.log(`  ✗ ${e}`)
    process.exit(1)
  }
  console.log(`\nПроверено файлов: ${files.length}. Ошибок нет.`)
}

main().catch((e) => {
  console.error(`Проверка не прошла: ${e.message}`)
  process.exit(1)
})
