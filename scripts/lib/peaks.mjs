/**
 * Пики громкости для таймлинии редактора реплик: пары min/max на окно, int8, base64.
 * Формат описан в docs/DIALOG_FORMAT.md; читают его и сайт, и локальный редактор.
 *
 * Живёт отдельным модулем, потому что нужен двум скриптам (генератору тестового
 * комплекта и импортёру реальных проектов), а алгоритм не из тех, что стоит
 * держать в двух копиях.
 */

import { spawn } from "node:child_process"

export const DEFAULT_PPS = 50
const SAMPLE_RATE = 48000

/** Запуск ffmpeg. `capture` — забрать stdout (для сырого PCM). */
export function runFfmpeg(args, { capture = false } = {}) {
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

/** Длительность и частота кадров медиафайла. */
export async function probe(file) {
  const { spawnSync } = await import("node:child_process")
  const r = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=r_frame_rate,codec_type",
      "-of", "json", file,
    ],
    { encoding: "utf8" },
  )
  if (r.status !== 0) throw new Error(`ffprobe: ${r.stderr?.slice(-200)}`)
  const data = JSON.parse(r.stdout)
  const durationMs = Math.round(Number(data.format?.duration ?? 0) * 1000)
  const video = (data.streams ?? []).find((s) => s.codec_type === "video")
  let fps = null
  if (video?.r_frame_rate && video.r_frame_rate !== "0/0") {
    const [n, d] = video.r_frame_rate.split("/").map(Number)
    if (d) fps = Math.round((n / d) * 1000) / 1000
  }
  const hasAudio = (data.streams ?? []).some((s) => s.codec_type === "audio")
  return { durationMs, fps, hasAudio }
}

/**
 * Считает пики из любого файла, у которого есть звук (wav, mp3, mp4 — всё равно).
 * Возвращает объект для записи в `*.peaks.json`.
 */
export async function computePeaks(file, { pps = DEFAULT_PPS } = {}) {
  const pcm = await runFfmpeg(
    ["-i", file, "-vn", "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"],
    { capture: true },
  )
  // Buffer из concat выровнен по началу, но на всякий случай режем по чётной длине.
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2))
  const win = Math.round(SAMPLE_RATE / pps)
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
    pps,
    bits: 8,
    dur: Number((samples.length / SAMPLE_RATE).toFixed(3)),
    data: data.toString("base64"),
  }
}
