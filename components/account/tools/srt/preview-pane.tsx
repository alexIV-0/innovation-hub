"use client"

import { useEffect, useState } from "react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { findTrack, translationOf } from "@/lib/tools/dialog/dialog-doc"
import { cn } from "@/lib/utils"
import { keyLabel } from "../shared/editor-state"
import { PreviewPane as SharedPreviewPane } from "../shared/preview-pane"
import { TrackAudio } from "../shared/track-audio"
import { useSrt } from "./srt-context"

/**
 * Зона 2 редактора титров: общее превью плюс то, что знает только он, — титры
 * поверх кадра, стемы дорожек и подпись «что звучит».
 */
export function PreviewPane({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const { t } = useWorkspace()
  const srt = useSrt()

  const step = (direction: 1 | -1) => {
    const now = srt.clock.getTimeMs()
    const next = srt.doc.cues
      .filter((c) => (direction > 0 ? c.startMs > now + 100 : c.startMs < now - 100))
      .sort((a, b) => (direction > 0 ? a.startMs - b.startMs : b.startMs - a.startMs))[0]
    if (next) srt.selectCue(next.id)
  }

  return (
    <SharedPreviewPane
      videoRef={videoRef}
      videoUrl={srt.videoUrl}
      missing={
        srt.doc.media.video ? tf(t.srtPreviewMissing, { file: srt.doc.media.video }) : t.srtNoVideo
      }
      // Звук видео — это «основная дорожка». Молчит, когда включён solo или
      // mute: тогда слушают дорожки персонажей, а не микс, где те же голоса
      // уже сведены.
      muted={srt.mainMuted}
      durationMs={srt.durationMs}
      clock={srt.clock}
      labels={{
        play: tf(t.srtPlayPause, { key: keyLabel(srt.prefs.keymap.playPause) }),
        prev: t.srtPrevCue,
        next: t.srtNextCue,
        sound: t.srtPreviewSound,
      }}
      onStep={step}
      overlay={<SubtitleOverlay />}
      audio={srt.audibleTrackIds.map((trackId) => {
        const url = srt.trackAudioUrl(trackId)
        return url ? (
          <TrackAudio key={trackId} url={url} playing={srt.clock.playing} clock={srt.clock} />
        ) : null
      })}
      sound={<AudioSource />}
      silent={srt.mainMuted && srt.audibleTrackIds.length === 0}
    />
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

/**
 * Что сейчас звучит — по матрице §15.3.
 *
 * Подпись обязана совпадать с тем, что слышно: «solo» на дорожке без своего
 * звука — это тишина, а не микс, и человек должен видеть причину, а не гадать.
 * То же и с mute: выключили всех — тишина, и так и написано.
 */
function AudioSource() {
  const { t } = useWorkspace()
  const srt = useSrt()

  const sounding = srt.doc.tracks.filter((track) => srt.audibleTrackIds.includes(track.id))
  const names = sounding.map((track) => track.name).join(", ")

  if (srt.soundMode === "solo") {
    if (sounding.length > 0) return <>{tf(t.srtSoundSolo, { names })}</>
    const silent = srt.doc.tracks.filter((track) => srt.flags[track.id]?.solo)
    return <>{tf(t.srtSoundSoloSilent, { names: silent.map((track) => track.name).join(", ") })}</>
  }
  if (srt.soundMode === "mute") {
    return sounding.length > 0 ? <>{tf(t.srtSoundTracks, { names })}</> : <>{t.srtSoundMuteSilent}</>
  }
  const mix = srt.doc.media.mix ?? srt.doc.media.video
  return <>{mix ? tf(t.srtSoundMain, { file: mix }) : t.srtSoundNone}</>
}
