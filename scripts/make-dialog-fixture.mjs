#!/usr/bin/env node
/**
 * Собирает тестовый комплект папки задачи для редактора реплик.
 *
 * Зачем скрипт, а не файлы в репозитории: медиа в git не место, а комплект нужен
 * воспроизводимым — те же тайминги, те же длительности, тот же документ.
 * Формат документа — docs/DIALOG_FORMAT.md, эталон — docs/dialog.example.json.
 *
 *   node scripts/make-dialog-fixture.mjs [outDir] [--stems] [--no-media]
 *
 * По умолчанию — то, что нужно редактору: общий звук (дорожка видео) плюс титры
 * по персонажам. Своего аудио у дорожек нет, волна одна общая.
 *   --stems     дополнительно нарезать аудио по персонажам (нужно озвучке, не редактору)
 *   --no-media  без видео и звука вообще: только документ и титры
 *
 * Требует ffmpeg в PATH (кроме --no-media). По умолчанию пишет в ./dialog-fixture.
 *
 * Что комплект проверяет, кроме «просто открылось»:
 *   • дорожку `no: 0` без аудио (текст, которому автоматика не нашла персонажа);
 *   • перекрытие реплик разных дорожек (говорят одновременно);
 *   • низкую уверенность атрибуции (фильтр «требует внимания»);
 *   • пустой перевод при непустом оригинале;
 *   • статус conflict; перенос реплики (movedFrom); список removed;
 *   • незнакомое поле в реплике (правило §2.5: при записи не терять);
 *   • реплику с высоким CPS и реплику короче секунды.
 */

import { spawn } from "node:child_process"
import { mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"

const ARGS = process.argv.slice(2)
const WITH_STEMS = ARGS.includes("--stems")
const NO_MEDIA = ARGS.includes("--no-media")
const OUT_DIR = path.resolve(ARGS.find((a) => !a.startsWith("--")) ?? "dialog-fixture")
const SR = 48000
const FPS = 25
const DURATION_MS = 40000
const PEAKS_PPS = 50

/** Дорожки. `audio: null` у нулевой — у «не распознано» своего звука нет. */
const TRACKS = [
  { id: "t00", no: 0, name: "Не распознано", color: "#8A8F98", hz: null },
  { id: "t01", no: 1, name: "Anna", color: "#5B8DEF", hz: 220 },
  { id: "t02", no: 2, name: "Bob", color: "#E0A458", hz: 330 },
]

/**
 * План реплик. Тайминги — миллисекунды, `endMs` эксклюзивен (§2.1–2.2 формата).
 * Порядок здесь произвольный: скрипт сортирует по правилу §2.4.
 */
const CUES = [
  {
    id: "c_0001", track: "t01", startMs: 1000, endMs: 3400,
    text: "So these guys just disappeared.",
    es: "Así que estos tipos simplemente desaparecieron.",
    fr: "Donc ces gars ont tout simplement disparu.",
    status: "auto", rev: 1, confidence: 0.91,
  },
  {
    id: "c_0002", track: "t02", startMs: 4200, endMs: 7100,
    text: "Yeah, on that stretch of road right above El Matador.",
    es: "Sí, en ese tramo de carretera justo encima de El Matador.",
    fr: "Oui, sur ce tronçon de route juste au-dessus d'El Matador.",
    status: "edited", rev: 3, confidence: 0.88,
    extra: { loudnessLufs: -18.4 },   // незнакомое поле: проверка §2.5
  },
  {
    id: "c_0003", track: "t01", startMs: 7600, endMs: 9000,
    text: "You know it?",
    es: "¿Lo sabes?", fr: "Tu le sais ?",
    status: "edited", rev: 2, confidence: 0.41, movedFrom: "t02",
    note: "автоматика приписала Бобу, на слух — Анна",
  },
  {
    id: "c_0004", track: "t02", startMs: 9500, endMs: 11200,
    text: "With the big rock?",
    es: "¿Con la gran roca?", fr: "Avec le gros rocher ?",
    status: "approved", rev: 4, confidence: 0.79,
  },
  // Перекрытие разных дорожек — норма: персонажи говорят одновременно.
  {
    id: "c_0005", track: "t01", startMs: 12000, endMs: 14000,
    text: "Wait, that's not what I said.",
    es: "Espera, eso no es lo que dije.", fr: "Attends, ce n'est pas ce que j'ai dit.",
    status: "auto", rev: 1, confidence: 0.67,
  },
  {
    id: "c_0006", track: "t02", startMs: 13200, endMs: 14800,
    text: "You absolutely said that.",
    es: "Claro que lo dijiste.", fr: "Tu l'as absolument dit.",
    status: "auto", rev: 1, confidence: 0.55,
  },
  // Не распознано: текст есть, персонажа автоматика не нашла.
  {
    id: "c_0007", track: "t00", startMs: 16000, endMs: 18000,
    text: "…something about the rock.",
    es: "", fr: "",
    status: "auto", rev: 1, confidence: 0.18,
  },
  // Высокий CPS: длинный текст в короткое время — подсказка должна загореться.
  {
    id: "c_0008", track: "t01", startMs: 20000, endMs: 23000,
    text: "And then the whole crew just packed up and left before anyone could ask a single question about it.",
    es: "Y luego todo el equipo recogió y se fue antes de que nadie pudiera preguntar nada.",
    fr: "Et puis toute l'équipe a plié bagage avant que quiconque puisse poser une question.",
    status: "auto", rev: 1, confidence: 0.83,
  },
  // Короткая реплика — проверка минимальной ширины клипа на таймлинии.
  {
    id: "c_0009", track: "t02", startMs: 25000, endMs: 26200,
    text: "Right.", es: "Claro.", fr: "D'accord.",
    status: "auto", rev: 1, confidence: 0.72,
  },
  // Пустой перевод при непустом оригинале — попадает в «требует внимания».
  {
    id: "c_0010", track: "t01", startMs: 30000, endMs: 33000,
    text: "Nobody wanted to talk about the last night of the shoot.",
    es: "", fr: "Personne ne voulait parler de la dernière nuit du tournage.",
    status: "auto", rev: 1, confidence: 0.9,
  },
  // Конфликт: двое правили одну реплику, победил один — человек смотрит глазами.
  {
    id: "c_0011", track: "t02", startMs: 35000, endMs: 38500,
    text: "I remember the truck, not the rock.",
    es: "Recuerdo el camión, no la roca.", fr: "Je me souviens du camion, pas du rocher.",
    status: "conflict", rev: 6, confidence: 0.86,
  },
]

const REMOVED = [{ id: "c_0099", at: "2026-08-24T09:41:12.000Z" }]

// ── ffmpeg ───────────────────────────────────────────────────────────────────

function run(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], {
      stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
    })
    const out = []
    const err = []
    if (capture) p.stdout.on("data", (c) => out.push(c))
    p.stderr.on("data", (c) => err.push(c))
    p.on("error", reject)
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(out))
        : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err).toString().slice(-400)}`)),
    )
  })
}

/**
 * Выражение сигнала: тон нужной частоты, звучащий только на своих репликах,
 * внутри — амплитудная модуляция, чтобы волна на таймлинии выглядела как речь,
 * а не как полка.
 *
 * Генератор — `aevalsrc`, а не `sine`: у `sine` уровень на выходе не полная
 * шкала (в ffmpeg 7.1 это −18 dBFS), и любой гейт поверх него даёт еле видимую
 * волну. В `aevalsrc` амплитуда задана явно и от версии не зависит.
 */
function signalExpr(hz, intervals) {
  if (!intervals.length) return "0"
  const inside = intervals
    .map(([a, b]) => `between(t,${(a / 1000).toFixed(3)},${(b / 1000).toFixed(3)})`)
    .join("+")
  const envelope = `0.3+0.55*abs(sin(2*PI*4.7*t))*abs(sin(2*PI*1.3*t+1))`
  return `if(${inside},${envelope},0)*sin(2*PI*${hz}*t)`
}

async function makeStem(hz, intervals, file) {
  await run([
    "-f", "lavfi",
    "-i", `aevalsrc='${signalExpr(hz, intervals)}':s=${SR}:d=${DURATION_MS / 1000}`,
    "-c:a", "pcm_s16le", "-ac", "1", "-y", file,
  ])
}

/** Пики: min/max на окно, int8, base64 — формат из docs/DIALOG_FORMAT.md §8 плана. */
async function makePeaks(wavFile) {
  const pcm = await run(["-i", wavFile, "-f", "s16le", "-ac", "1", "-ar", String(SR), "-"], {
    capture: true,
  })
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  const win = Math.round(SR / PEAKS_PPS)
  const pairs = Math.ceil(samples.length / win)
  const data = Buffer.alloc(pairs * 2)
  for (let i = 0; i < pairs; i += 1) {
    let lo = 0
    let hi = 0
    const from = i * win
    const to = Math.min(from + win, samples.length)
    for (let j = from; j < to; j += 1) {
      const v = samples[j]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    // int16 → int8 со знаком; -128 не используем, чтобы диапазон был симметричным.
    data.writeInt8(Math.max(-127, Math.round((lo / 32768) * 127)), i * 2)
    data.writeInt8(Math.min(127, Math.round((hi / 32768) * 127)), i * 2 + 1)
  }
  return {
    version: 1,
    pps: PEAKS_PPS,
    bits: 8,
    dur: Number((samples.length / SR).toFixed(3)),
    data: data.toString("base64"),
  }
}

// ── SRT ──────────────────────────────────────────────────────────────────────

function srtTime(ms) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0")
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, "0")
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0")
  const f = String(ms % 1000).padStart(3, "0")
  return `${h}:${m}:${s},${f}`
}

function toSrt(cues, pick) {
  return cues
    .map((c) => pick(c))
    .map((text, i) => ({ text, c: cues[i] }))
    .filter((x) => x.text)
    .map((x, i) => `${i + 1}\n${srtTime(x.c.startMs)} --> ${srtTime(x.c.endMs)}\n${x.text}\n`)
    .join("\n")
}

// ── документ ─────────────────────────────────────────────────────────────────

/** Порядок ключей — часть контракта (§2.4, §3), поэтому объекты собираются руками. */
function buildDoc(usedTracks) {
  const sorted = [...CUES].sort(
    (a, b) => a.startMs - b.startMs || a.track.localeCompare(b.track) || a.id.localeCompare(b.id),
  )
  return {
    format: "dialogDoc",
    version: 1,
    id: "dd_fixture01",
    revision: 12,
    updatedAt: "2026-08-24T10:00:00.000Z",
    updatedBy: "node:dialogDocBuild",
    producer: "scripts/make-dialog-fixture.mjs 1",
    media: {
      video: NO_MEDIA ? null : "source.mp4",
      mix: null,
      peaks: NO_MEDIA ? null : "mix.peaks.json",
      durationMs: DURATION_MS,
      fps: NO_MEDIA ? null : FPS,
    },
    languages: { original: "en", targets: ["es", "fr"] },
    rules: {
      maxCps: 25,
      maxTranslationRatio: 1.2,
      minDurationMs: 250,
      minGapMs: 80,
      overlapWithinTrack: "forbid",
    },
    tracks: usedTracks.map((t) => ({
      id: t.id,
      no: t.no,
      name: t.name,
      color: t.color,
      // Обычный случай: у дорожки персонажа своего звука нет — она это титры.
      audio: WITH_STEMS && t.hz ? `${String(t.no).padStart(2, "0")}/audio.wav` : null,
      peaks: WITH_STEMS && t.hz ? `${String(t.no).padStart(2, "0")}/audio.peaks.json` : null,
      diar: {
        engine: "fixture",
        speaker: t.hz ? `s${t.no - 1}` : null,
        confidence: t.hz ? 0.8 : 0.18,
      },
      voice: { provider: null, voiceId: null, params: {} },
    })),
    cues: sorted.map((c) => {
      const tr = {}
      if (c.es) tr.es = { text: c.es, status: c.status === "approved" ? "approved" : "draft" }
      if (c.fr) tr.fr = { text: c.fr, status: "draft" }
      const cue = {
        id: c.id,
        trackId: c.track,
        startMs: c.startMs,
        endMs: c.endMs,
        text: c.text,
        tr,
        status: c.status,
        rev: c.rev,
        origin: {
          kind: "auto",
          file: `${String(TRACKS.find((t) => t.id === c.track).no).padStart(2, "0")}/orig.srt`,
          index: 1,
          speaker: c.track === "t00" ? null : `s${TRACKS.find((t) => t.id === c.track).no - 1}`,
          confidence: c.confidence,
        },
        note: c.note ?? "",
        voice: { takes: [] },
      }
      if (c.movedFrom) cue.movedFrom = c.movedFrom
      return { ...cue, ...(c.extra ?? {}) }
    }),
    removed: REMOVED,
  }
}

const README = `# Тестовый комплект: папка задачи редактора реплик

Собран \`scripts/make-dialog-fixture.mjs\` (репозиторий innovation-hub). Пересобрать:

\`\`\`bash
node scripts/make-dialog-fixture.mjs <куда>
\`\`\`

Формат документа — \`docs/DIALOG_FORMAT.md\`. Медиа синтетическое: картинка — тестовый
паттерн, «речь» — модулированные тоны (220 Гц Anna, 330 Гц Bob, 480 Гц в миксе там, где
автоматика никого не распознала). Смысл не в правдоподобии звука, а в том, что тайминги
реплик, волна и документ совпадают между собой.

## Что внутри

| файл | что |
|---|---|
| \`source.mp4\` | 40 с, ${FPS} fps, звук — общий микс всех персонажей |
| \`mix.peaks.json\` | волна общего звука: её и рисует таймлиния |
| \`dialog.json\` | документ: 3 дорожки (персонажа), 11 реплик, 2 языка |
| \`01/\`, \`02/\` | сырьё титров персонажа: \`orig.srt\`, \`es.srt\`, \`fr.srt\` |

Своего аудио у дорожек нет намеренно: дорожка — это персонаж со своими титрами, звук нужен
один, общий. Поэтому комплект по умолчанию проверяет **подстановку общей волны**: на каждой
дорожке рисуется \`mix.peaks.json\` — приглушённо и с пометкой «общая».

Два других пути отрисовки проверяются флагами: \`--stems\` даёт дорожкам своё аудио и свою
волну, \`--no-media\` — совсем без видео и звука (линейка и клипы, инструмент обязан
остаться рабочим).

Папки \`exports/\` нет — её создаёт инструмент при первом экспорте.

## Какие случаи он проверяет

- дорожка \`no: 0\` без аудио: реплика \`c_0007\`, уверенность 0.18 — должна быть первой в
  фильтре «требует внимания»;
- перекрытие дорожек: \`c_0005\` (12.0–14.0) и \`c_0006\` (13.2–14.8) — норма, не ошибка;
- перенесённая реплика: \`c_0003\` с \`movedFrom: "t02"\`;
- пустой перевод при непустом оригинале: \`c_0010\` (нет \`es\`);
- статус \`conflict\`: \`c_0011\`;
- незнакомое поле: \`loudnessLufs\` у \`c_0002\` — после сохранения обязано остаться
  (правило §2.5 формата);
- высокий CPS: \`c_0008\` (длинный текст в 3 с);
- короткий клип: \`c_0009\` (1.2 с) — проверка минимальной ширины на таймлинии;
- \`removed\`: id \`c_0099\` — повторный прогон ноды не должен его воскресить.
`

// ── сборка ───────────────────────────────────────────────────────────────────

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(OUT_DIR, { recursive: true })

  const used = TRACKS.filter((t) => CUES.some((c) => c.track === t.id))
  const tmp = path.join(OUT_DIR, ".tmp")
  await mkdir(tmp, { recursive: true })

  // Титры — всегда: это единственное, без чего задача бессмысленна.
  for (const t of used) {
    const dir = path.join(OUT_DIR, String(t.no).padStart(2, "0"))
    await mkdir(dir, { recursive: true })
    const own = CUES.filter((c) => c.track === t.id)
    // Пустой файл языка не создаём: если перевода нет, файла в папке тоже не бывает.
    const written = []
    for (const [name, pick] of [
      ["orig.srt", (c) => c.text],
      ["es.srt", (c) => c.es],
      ["fr.srt", (c) => c.fr],
    ]) {
      const body = toSrt(own, pick)
      if (!body) continue
      await writeFile(path.join(dir, name), body)
      written.push(name)
    }
    console.log(`  ✓ ${String(t.no).padStart(2, "0")}/${written.join(" · ")}`)
  }

  if (!NO_MEDIA) {
    // Тоны по персонажам нужны, чтобы собрать из них общий звук; сохраняем их
    // отдельными файлами только при --stems.
    const parts = []
    for (const t of [...used.filter((x) => x.hz), { no: 99, hz: 480, id: "t00" }]) {
      const intervals = CUES.filter((c) => c.track === t.id).map((c) => [c.startMs, c.endMs])
      if (!intervals.length) continue
      const file =
        WITH_STEMS && t.no !== 99
          ? path.join(OUT_DIR, String(t.no).padStart(2, "0"), "audio.wav")
          : path.join(tmp, `part-${t.no}.wav`)
      await makeStem(t.hz, intervals, file)
      parts.push(file)
      if (WITH_STEMS && t.no !== 99) {
        const rel = `${String(t.no).padStart(2, "0")}/audio.wav`
        await writeFile(
          path.join(OUT_DIR, String(t.no).padStart(2, "0"), "audio.peaks.json"),
          JSON.stringify(await makePeaks(file)),
        )
        console.log(`  ✓ ${rel} · audio.peaks.json`)
      }
    }

    const mix = path.join(tmp, "mix.wav")
    await run([
      ...parts.flatMap((f) => ["-i", f]),
      // normalize=0 сохраняет уровни дорожек (штатный amix поделил бы на число
      // входов и микс стал бы еле слышен), volume=0.55 оставляет запас: на
      // перекрытии реплик дорожки складываются и сумма подходит к клиппингу.
      "-filter_complex", `amix=inputs=${parts.length}:normalize=0,volume=0.55`,
      "-c:a", "pcm_s16le", "-y", mix,
    ])

    // Волна общего звука — одна на всю задачу, её и рисует таймлиния.
    await writeFile(path.join(OUT_DIR, "mix.peaks.json"), JSON.stringify(await makePeaks(mix)))
    console.log("  ✓ mix.peaks.json")

    await run([
      "-f", "lavfi",
      "-i", `testsrc2=size=1280x720:rate=${FPS}:duration=${DURATION_MS / 1000}`,
      "-i", mix,
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k", "-shortest", "-y", path.join(OUT_DIR, "source.mp4"),
    ])
    console.log("  ✓ source.mp4")
  }

  const doc = buildDoc(used)
  await writeFile(path.join(OUT_DIR, "dialog.json"), `${JSON.stringify(doc, null, 2)}\n`)
  await writeFile(path.join(OUT_DIR, "README.md"), README)
  await rm(tmp, { recursive: true, force: true })

  console.log(`  ✓ dialog.json — ${doc.tracks.length} дорожки, ${doc.cues.length} реплик`)
  console.log(
    `\nГотово: ${OUT_DIR}${NO_MEDIA ? " (без медиа)" : WITH_STEMS ? " (со стемами)" : ""}`,
  )
}

main().catch((e) => {
  console.error(`Не собралось: ${e.message}`)
  process.exit(1)
})
