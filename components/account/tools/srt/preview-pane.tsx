"use client"

import { useEffect, useRef, useState } from "react"
import { AudioLines, Film, Pause, Play, SkipBack, SkipForward } from "lucide-react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { findTrack, translationOf } from "@/lib/tools/srt/dialog-doc"
import { formatTc } from "@/lib/tools/srt/timecode"
import { cn } from "@/lib/utils"
import { keyLabel } from "./editor-state"
import { useSrt } from "./srt-context"
import { TrackAudio } from "./track-audio"

/**
 * Зона 2: превью.
 *
 * Видео здесь — единственные часы редактора. Если файла в папке нет, кадр не
 * показывается, но титры текущего момента остаются: тайминги и текст правятся
 * и без картинки (§15.1).
 */
export function PreviewPane({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const { t } = useWorkspace()
  const srt = useSrt()

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-ws-well p-3">
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-[5px] border border-white/[0.07] bg-black">
        {srt.videoUrl ? (
          <video
            ref={videoRef}
            src={srt.videoUrl}
            playsInline
            preload="metadata"
            // Звук видео — это «основная дорожка». Молчит только когда включён
            // solo: тогда слушают выбранную дорожку персонажа, а не микс.
            muted={srt.mainMuted}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-ws-5">
            <Film className="h-10 w-10" />
            <p className="text-[12px] tracking-[0.32px]">
              {srt.doc.media.video
                ? tf(t.srtPreviewMissing, { file: srt.doc.media.video })
                : t.srtNoVideo}
            </p>
          </div>
        )}
        <SubtitleOverlay />
      </div>

      {srt.soloTrackIds.map((trackId) => {
        const url = srt.trackAudioUrl(trackId)
        return url ? (
          <TrackAudio key={trackId} url={url} playing={srt.clock.playing} clock={srt.clock} />
        ) : null
      })}

      <Transport />

      <div className="flex items-center gap-2.5 rounded-[5px] border border-white/[0.07] bg-ws-raised px-3 py-2.5">
        <AudioLines
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            srt.mainMuted && srt.soloTrackIds.length === 0 ? "text-ws-5" : "text-ws-accent",
          )}
        />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.32px] text-ws-4">
            {t.srtPreviewSound}
          </span>
          <span className="truncate text-[13px] text-ws-2">
            <AudioSource />
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Титры поверх кадра — выбранного языка и только для видимых дорожек: скрытая
 * через shy дорожка не рисуется (§15.4). Если говорят двое, строки идут одна
 * под другой с цветной точкой дорожки.
 */
function SubtitleOverlay() {
  const srt = useSrt()
  const [ids, setIds] = useState<string[]>([])

  useEffect(() => {
    return srt.clock.subscribe((ms) => {
      const visible = new Set(srt.visibleTracks.map((track) => track.id))
      const hits = srt.doc.cues
        .filter((c) => visible.has(c.trackId) && ms >= c.startMs && ms <= c.endMs)
        .map((c) => c.id)
      setIds((current) =>
        current.length === hits.length && current.every((id, i) => id === hits[i])
          ? current
          : hits,
      )
    })
  }, [srt.clock, srt.doc.cues, srt.visibleTracks])

  if (ids.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-[18px] left-0 right-0 flex flex-col items-center gap-1 px-8">
      {ids.map((id) => {
        const cue = srt.doc.cues.find((c) => c.id === id)
        if (!cue) return null
        const track = findTrack(srt.doc, cue.trackId)
        // Как и на клипах: показываем выбранный язык, а пока перевода нет —
        // оригинал приглушённо. Пустая строка вместо титра читалась бы как
        // «здесь никто не говорит».
        const translated = srt.lang ? translationOf(cue, srt.lang) : ""
        const untranslated = Boolean(srt.lang) && !translated
        const text = translated || cue.text
        if (!text) return null
        return (
          <span
            key={id}
            className="flex max-w-full items-center gap-2 rounded-[3px] bg-black/55 px-2.5 py-1 text-center text-[15px] font-medium text-white"
          >
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: track?.color ?? "#5b9be0" }}
            />
            <span className={cn("min-w-0 text-pretty", untranslated && "italic opacity-60")}>
              {text}
            </span>
          </span>
        )
      })}
    </div>
  )
}

function Transport() {
  const { t } = useWorkspace()
  const srt = useSrt()
  const nowRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    return srt.clock.subscribe((ms) => {
      const el = nowRef.current
      if (el) el.textContent = formatTc(ms)
    })
  }, [srt.clock])

  const step = (direction: 1 | -1) => {
    const now = srt.clock.getTimeMs()
    const candidates = srt.doc.cues
      .filter((c) => (direction > 0 ? c.startMs > now + 100 : c.startMs < now - 100))
      .sort((a, b) => (direction > 0 ? a.startMs - b.startMs : b.startMs - a.startMs))
    const next = candidates[0]
    if (next) srt.selectCue(next.id)
  }

  return (
    <div className="flex items-center gap-2.5 rounded-[5px] border border-white/[0.07] bg-ws-raised px-2.5 py-2">
      <button
        type="button"
        onClick={srt.clock.togglePlay}
        title={tf(t.srtPlayPause, { key: keyLabel(srt.prefs.keymap.playPause) })}
        className="flex h-8 w-8 items-center justify-center rounded bg-ws-action text-white hover:bg-ws-action-hover"
      >
        {srt.clock.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <button
        type="button"
        onClick={() => step(-1)}
        title={t.srtPrevCue}
        className="flex h-[30px] w-[30px] items-center justify-center rounded border border-white/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
      >
        <SkipBack className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={() => step(1)}
        title={t.srtNextCue}
        className="flex h-[30px] w-[30px] items-center justify-center rounded border border-white/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
      >
        <SkipForward className="h-[18px] w-[18px]" />
      </button>
      <div className="flex-1" />
      <span ref={nowRef} className="font-mono text-[13px] tabular-nums text-ws-1">
        {formatTc(0)}
      </span>
      <span className="font-mono text-[13px] tabular-nums text-ws-4">
        / {formatTc(srt.durationMs)}
      </span>
    </div>
  )
}

/**
 * Что сейчас звучит — по матрице §15.3.
 *
 * Подпись обязана совпадать с тем, что слышно: «solo» на дорожке без своего
 * звука — это тишина, а не микс, и человек должен видеть причину, а не гадать.
 */
function AudioSource() {
  const { t } = useWorkspace()
  const srt = useSrt()

  if (srt.mainMuted) {
    const sounding = srt.doc.tracks.filter((track) => srt.soloTrackIds.includes(track.id))
    if (sounding.length > 0) {
      return <>{tf(t.srtSoundSolo, { names: sounding.map((track) => track.name).join(", ") })}</>
    }
    const silent = srt.doc.tracks.filter((track) => srt.flags[track.id]?.solo)
    return <>{tf(t.srtSoundSoloSilent, { names: silent.map((track) => track.name).join(", ") })}</>
  }
  const mix = srt.doc.media.mix ?? srt.doc.media.video
  return <>{mix ? tf(t.srtSoundMain, { file: mix }) : t.srtSoundNone}</>
}
