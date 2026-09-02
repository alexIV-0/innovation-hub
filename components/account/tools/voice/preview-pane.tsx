"use client"

import { useEffect, useState } from "react"

import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { findTrack } from "@/lib/tools/dialog/dialog-doc"
import { synthText, takeStartMs } from "@/lib/tools/dialog/voice"
import { cn } from "@/lib/utils"
import { keyLabel } from "../shared/editor-state"
import { PreviewPane as SharedPreviewPane } from "../shared/preview-pane"
import { TrackAudio } from "../shared/track-audio"
import { videoNoticeText } from "../shared/use-task-folder"
import { useVoice } from "./voice-context"

/**
 * Зона превью инструмента озвучки.
 *
 * Отличается от редактора титров тем, **что звучит**: по умолчанию слышно
 * сгенерированное, а звук видео заглушён — человек проверяет дубляж, а не
 * оригинал. Титры на кадре остаются: по ним видно, что должно звучать.
 */
export function PreviewPane({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const { t } = useWorkspace()
  const voice = useVoice()

  const step = (direction: 1 | -1) => {
    const now = voice.clock.getTimeMs()
    const next = voice.doc.cues
      .filter((c) => (direction > 0 ? c.startMs > now + 100 : c.startMs < now - 100))
      .sort((a, b) => (direction > 0 ? a.startMs - b.startMs : b.startMs - a.startMs))[0]
    if (next) voice.selectCue(next.id)
  }

  return (
    <SharedPreviewPane
      videoRef={videoRef}
      videoUrl={voice.video.kind === "ready" ? voice.video.url : null}
      missing={videoNoticeText(t, voice.video)}
      muted={voice.mainMuted}
      durationMs={voice.durationMs}
      clock={voice.clock}
      labels={{
        play: tf(t.srtPlayPause, { key: keyLabel(voice.prefs.keymap.playPause) }),
        prev: t.srtPrevCue,
        next: t.srtNextCue,
        sound: t.srtPreviewSound,
      }}
      onStep={step}
      overlay={<SpokenOverlay />}
      audio={voice.audibleTakes.map(({ cue, take }) => {
        const url = voice.takeUrl(take)
        return url ? (
          <TrackAudio
            key={take.id}
            url={url}
            playing={voice.clock.playing}
            clock={voice.clock}
            startMs={takeStartMs(cue, take)}
            rate={take.rate}
            gainDb={take.gainDb}
          />
        ) : null
      })}
      sound={<SoundLabel />}
      silent={voice.soundMode === "takes" && voice.audibleTakes.length === 0}
    />
  )
}

/**
 * Титры поверх кадра — тот текст, который озвучиваем.
 *
 * Показывается разметка, если она есть: слышно будет именно её, и расхождение
 * между надписью и звуком сбивало бы с толку сильнее, чем видимые теги.
 */
function SpokenOverlay() {
  const voice = useVoice()
  const [ids, setIds] = useState<string[]>([])

  useEffect(() => {
    return voice.clock.subscribe((ms) => {
      const visible = new Set(voice.visibleTracks.map((track) => track.id))
      const hits = voice.doc.cues
        .filter((c) => visible.has(c.trackId) && ms >= c.startMs && ms <= c.endMs)
        .map((c) => c.id)
      setIds((current) =>
        current.length === hits.length && current.every((id, i) => id === hits[i])
          ? current
          : hits,
      )
    })
  }, [voice.clock, voice.doc.cues, voice.visibleTracks])

  if (ids.length === 0) return null

  return (
    <div className="pointer-events-none absolute bottom-[18px] left-0 right-0 flex flex-col items-center gap-1 px-8">
      {ids.map((id) => {
        const cue = voice.doc.cues.find((c) => c.id === id)
        if (!cue) return null
        const track = findTrack(voice.doc, cue.trackId)
        const text = synthText(voice.doc, cue, voice.lang)
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
            <span className="min-w-0 text-pretty">{text}</span>
          </span>
        )
      })}
    </div>
  )
}

/** Что сейчас звучит. Подпись обязана совпадать с тем, что слышно. */
function SoundLabel() {
  const { t } = useWorkspace()
  const voice = useVoice()

  if (voice.soundMode === "original") {
    const mix = voice.doc.media.mix ?? voice.doc.media.video
    return <>{mix ? tf(t.srtSoundMain, { file: mix }) : t.srtSoundNone}</>
  }
  if (voice.audibleTakes.length === 0) {
    return <>{t.voiceSoundNothing}</>
  }
  const names = [
    ...new Set(
      voice.audibleTakes
        .map(({ cue }) => findTrack(voice.doc, cue.trackId)?.name)
        .filter((name): name is string => Boolean(name)),
    ),
  ]
  return (
    <span className={cn("truncate")}>
      {tf(t.voiceSoundTakes, { count: voice.audibleTakes.length, names: names.join(", ") })}
    </span>
  )
}
