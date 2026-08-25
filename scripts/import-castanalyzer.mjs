#!/usr/bin/env node
/**
 * Превращает проект Cast Analyzer Next в папку задачи редактора реплик:
 * читает его разбор и собирает `dialog.json` (docs/DIALOG_FORMAT.md).
 *
 *   node scripts/import-castanalyzer.mjs --project <DUB/Movie> --video <file.mp4> \
 *        --out <dir> [--stems] [--pps 50]
 *
 * Что берём из проекта:
 *   04_SUBTITLES/all_dialogue.json  реплики: тайминги, текст, спикер, уверенность, needs_review
 *   04_SUBTITLES/SPEAKER_XX.srt     сырьё титров персонажа (кладём в NN/orig.srt)
 *   03_CAST/cast.json               имена персонажей и их статистика
 *   02_ANALYSIS/analysis.json       чем считали (движок попадает в tracks[].diar)
 *   05_AUDIO_STEMS/*_guide.mp3      стемы (только с --stems: редактору они не нужны)
 *
 * Чего не делаем: не трогаем исходный проект и не переносим абсолютные пути из
 * его JSON — они с чужой машины (`C:\\Users\\...`) и здесь не значат ничего.
 *
 * Это прототип ноды `dialogDocBuild` из плана: та же работа, но на JS и снаружи
 * конвейера — чтобы получить настоящие данные для редактора уже сейчас.
 */

import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

import { computePeaks, probe, DEFAULT_PPS } from "./lib/peaks.mjs"

// ── аргументы ────────────────────────────────────────────────────────────────

function args() {
  const a = process.argv.slice(2)
  const get = (name) => {
    const i = a.indexOf(`--${name}`)
    return i >= 0 ? a[i + 1] : null
  }
  const project = get("project")
  const out = get("out")
  if (!project || !out) {
    console.error(
      "Использование: node scripts/import-castanalyzer.mjs --project <DUB/Movie> " +
        "--video <file.mp4> --out <dir> [--stems] [--pps 50]",
    )
    process.exit(2)
  }
  return {
    project: path.resolve(project),
    video: get("video") ? path.resolve(get("video")) : null,
    out: path.resolve(out),
    stems: a.includes("--stems"),
    pps: Number(get("pps") ?? DEFAULT_PPS),
  }
}

const readJson = async (f) => JSON.parse(await readFile(f, "utf8"))

/** `SPEAKER_07` → 7, `UNKNOWN` → 0. Номер = имя папки и идентификатор дорожки. */
function trackNo(speakerName) {
  const m = /^SPEAKER_(\d+)$/i.exec(speakerName)
  return m ? Number.parseInt(m[1], 10) : 0
}

const dir2 = (no) => String(no).padStart(2, "0")
const msOf = (sec) => Math.round(Number(sec) * 1000)

// ── SRT ──────────────────────────────────────────────────────────────────────

function srtTime(ms) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0")
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, "0")
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0")
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, "0")}`
}

function toSrt(cues) {
  return cues
    .filter((c) => c.text)
    .map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`)
    .join("\n")
}

// ── сборка документа ─────────────────────────────────────────────────────────

const RULES = {
  maxCps: 25,
  maxTranslationRatio: 1.2,
  minDurationMs: 250,
  minGapMs: 80,
  overlapWithinTrack: "forbid",
}

function buildTracks(lines, cast, engine) {
  const byNo = new Map()
  for (const line of lines) {
    const no = trackNo(line.speaker_name)
    if (!byNo.has(no)) byNo.set(no, { no, raw: line.speaker_name, conf: [], name: null })
    byNo.get(no).conf.push(Number(line.confidence ?? 0))
  }
  for (const sp of cast?.speakers ?? []) {
    const t = byNo.get(trackNo(sp.id))
    if (t) t.name = sp.display_name && sp.display_name !== sp.id ? sp.display_name : sp.id
  }
  return [...byNo.values()]
    .sort((a, b) => a.no - b.no)
    .map((t) => ({
      id: `t${dir2(t.no)}`,
      no: t.no,
      name: t.no === 0 ? "Не распознано" : (t.name ?? t.raw),
      color: null,
      audio: null,
      peaks: null,
      diar: {
        engine,
        speaker: t.no === 0 ? null : t.raw,
        confidence: Number((t.conf.reduce((s, v) => s + v, 0) / t.conf.length).toFixed(3)),
      },
      voice: { provider: null, voiceId: null, params: {} },
    }))
}

function buildCues(lines) {
  const indexPerTrack = new Map()
  return lines
    .map((line, i) => {
      const no = trackNo(line.speaker_name)
      const idx = (indexPerTrack.get(no) ?? 0) + 1
      indexPerTrack.set(no, idx)
      const cue = {
        id: `c_${String(i + 1).padStart(4, "0")}`,
        trackId: `t${dir2(no)}`,
        startMs: msOf(line.start),
        endMs: msOf(line.end),
        text: String(line.text ?? "").trim(),
        tr: {},
        status: "auto",
        rev: 1,
        origin: {
          kind: "auto",
          file: `${dir2(no)}/orig.srt`,
          index: idx,
          speaker: line.raw_speaker ?? null,
          confidence: Number(line.confidence ?? 0),
          needsReview: line.needs_review === true,
          reviewReason: line.needs_review ? (line.reason ?? "") : "",
        },
        note: "",
        voice: { takes: [] },
      }
      return cue
    })
    .sort(
      (a, b) =>
        a.startMs - b.startMs || a.trackId.localeCompare(b.trackId) || a.id.localeCompare(b.id),
    )
}

/** Проверки перед записью: чинить чужие данные молча нельзя, но сказать — обязаны. */
function check(doc) {
  const problems = []
  const short = doc.cues.filter((c) => c.endMs - c.startMs < doc.rules.minDurationMs)
  if (short.length) problems.push(`реплик короче ${doc.rules.minDurationMs} мс: ${short.length}`)
  const beyond = doc.cues.filter((c) => c.endMs > doc.media.durationMs)
  if (beyond.length) problems.push(`реплик за пределами длительности: ${beyond.length}`)
  const empty = doc.cues.filter((c) => !c.text)
  if (empty.length) problems.push(`реплик без текста: ${empty.length}`)
  let overlaps = 0
  for (const t of doc.tracks) {
    const own = doc.cues.filter((c) => c.trackId === t.id)
    for (let i = 1; i < own.length; i += 1) if (own[i].startMs < own[i - 1].endMs) overlaps += 1
  }
  if (overlaps) problems.push(`пересечений внутри дорожки: ${overlaps} (правило станет "warn")`)
  return { problems, overlaps }
}

// ── основное ─────────────────────────────────────────────────────────────────

/**
 * Собирает одну папку задачи. Экспортируется, чтобы сборщик папки OUT
 * (scripts/build-out-folder.mjs) не запускал этот скрипт процессом на каждую сцену.
 */
export async function importProject(opt) {
  // Тихий режим — для сборщика папки OUT: он печатает свою строку на задачу.
  const say = opt.quiet ? () => {} : (m) => console.log(m)
  const subsDir = path.join(opt.project, "04_SUBTITLES")
  const lines = await readJson(path.join(subsDir, "all_dialogue.json"))
  const cast = existsSync(path.join(opt.project, "03_CAST", "cast.json"))
    ? await readJson(path.join(opt.project, "03_CAST", "cast.json"))
    : null
  const analysis = existsSync(path.join(opt.project, "02_ANALYSIS", "analysis.json"))
    ? await readJson(path.join(opt.project, "02_ANALYSIS", "analysis.json"))
    : null
  const engine = analysis
    ? `${analysis.pipeline ?? "cast-analyzer"} ${analysis.app_version ?? ""}`.trim()
    : "cast-analyzer"

  await rm(opt.out, { recursive: true, force: true })
  await mkdir(opt.out, { recursive: true })

  const tracks = buildTracks(lines, cast, engine)
  const cues = buildCues(lines)

  // Сырьё титров: по файлу на персонажа. Свой SRT из проекта копируем, если есть,
  // иначе собираем из реплик — чтобы `origin.file` всегда указывал на живой файл.
  for (const t of tracks) {
    const dir = path.join(opt.out, dir2(t.no))
    await mkdir(dir, { recursive: true })
    const src = path.join(subsDir, t.no === 0 ? "UNKNOWN.srt" : `SPEAKER_${dir2(t.no)}.srt`)
    if (existsSync(src)) await copyFile(src, path.join(dir, "orig.srt"))
    else await writeFile(path.join(dir, "orig.srt"), toSrt(cues.filter((c) => c.trackId === t.id)))
  }

  let durationMs = Math.max(...cues.map((c) => c.endMs))
  let fps = null
  if (opt.video) {
    const info = await probe(opt.video)
    durationMs = info.durationMs || durationMs
    fps = info.fps
    await copyFile(opt.video, path.join(opt.out, "source.mp4"))
    say("  ✓ source.mp4")
    if (info.hasAudio) {
      const peaks = await computePeaks(opt.video, { pps: opt.pps })
      await writeFile(path.join(opt.out, "mix.peaks.json"), JSON.stringify(peaks))
      say("  ✓ mix.peaks.json — общая волна")
    }
  }

  if (opt.stems) {
    for (const t of tracks) {
      const src = path.join(
        opt.project,
        "05_AUDIO_STEMS",
        t.no === 0 ? "UNKNOWN_guide.mp3" : `SPEAKER_${dir2(t.no)}_guide.mp3`,
      )
      if (!existsSync(src)) continue
      const dir = path.join(opt.out, dir2(t.no))
      await copyFile(src, path.join(dir, "audio.mp3"))
      await writeFile(
        path.join(dir, "audio.peaks.json"),
        JSON.stringify(await computePeaks(src, { pps: opt.pps })),
      )
      t.audio = `${dir2(t.no)}/audio.mp3`
      t.peaks = `${dir2(t.no)}/audio.peaks.json`
      say(`  ✓ ${dir2(t.no)}/audio.mp3 · audio.peaks.json`)
    }
  }

  const doc = {
    format: "dialogDoc",
    version: 1,
    id: `dd_${path.basename(opt.project).toLowerCase().replace(/[^a-z0-9]+/g, "")}`,
    revision: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: "node:castAnalyzerImport",
    producer: "scripts/import-castanalyzer.mjs 1",
    media: {
      video: opt.video ? "source.mp4" : null,
      mix: null,
      peaks: existsSync(path.join(opt.out, "mix.peaks.json")) ? "mix.peaks.json" : null,
      durationMs,
      fps,
    },
    // Переводов в проекте нет: они появятся на следующем шаге конвейера.
    languages: { original: "en", targets: [] },
    rules: { ...RULES },
    tracks,
    cues,
    removed: [],
  }

  const { problems, overlaps } = check(doc)
  if (overlaps) doc.rules.overlapWithinTrack = "warn"
  await writeFile(path.join(opt.out, "dialog.json"), `${JSON.stringify(doc, null, 2)}\n`)

  const review = doc.cues.filter((c) => c.origin.needsReview).length
  const unknown = doc.cues.filter((c) => c.trackId === "t00").length
  return {
    out: opt.out,
    tracks: doc.tracks.length,
    cues: doc.cues.length,
    review,
    unknown,
    durationMs: doc.media.durationMs,
    problems,
  }
}

/** Запуск из командной строки; при импорте модуля ничего не делает. */
if (import.meta.url === `file://${process.argv[1]}`) {
  const opt = args()
  importProject(opt)
    .then((r) => {
      console.log(
        `  ✓ dialog.json — ${r.tracks} дорожек, ${r.cues} реплик, ` +
          `${r.review} на проверку, ${r.unknown} не распознано`,
      )
      if (r.problems.length) {
        console.log("\nЧто в данных стоит посмотреть:")
        for (const p of r.problems) console.log(`  • ${p}`)
      }
      console.log(`\nГотово: ${r.out}`)
    })
    .catch((e) => {
      console.error(`Не собралось: ${e.message}`)
      process.exit(1)
    })
}
