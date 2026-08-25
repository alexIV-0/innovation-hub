"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Captions,
  Check,
  CloudOff,
  Download,
  HelpCircle,
  Loader2,
  Settings,
  TriangleAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { ResizeGrip } from "@/components/account/resize-grip"
import { useDragSize } from "@/components/account/use-drag-size"
import { tf } from "@/components/account/i18n"
import { useWorkspace } from "@/components/account/workspace/workspace-context"
import {
  addCue as addCueOp,
  addLanguage as addLanguageOp,
  addTrack as addTrackOp,
  docDurationMs,
  mergeCueWithNext,
  mergeCues as mergeCuesOp,
  moveCueToTrack,
  removeCue as removeCueOp,
  removeLanguage as removeLanguageOp,
  renameTrack as renameTrackOp,
  setTrackColor as setTrackColorOp,
  setCueTiming,
  setCueText,
  setCueTranslation,
  splitCue as splitCueOp,
} from "@/lib/tools/srt/dialog-doc"
import { exportDocument } from "@/lib/tools/srt/export"
import { MAX_PPS, MIN_PPS, zoomStep } from "@/lib/tools/srt/timeline"
import { cn } from "@/lib/utils"
import { SourcePicker } from "../source-picker"
import { useTools, type ToolInstance } from "../tools-context"
import { CueList } from "./cue-list"
import {
  DEFAULT_LEFT_W,
  DEFAULT_TIMELINE_H,
  useHeldTool,
  usePlayerClock,
  useUndoableDoc,
  useViewPrefs,
  type HotkeyAction,
  type TimelineTool,
  type TrackFlags,
} from "./editor-state"
import { SrtHelpDialog } from "./help-dialog"
import { LanguagePicker, languageName } from "./language-picker"
import { PreviewPane } from "./preview-pane"
import { SrtProvider, type SrtApi } from "./srt-context"
import { TimelinePane } from "./timeline-pane"
import {
  findEntry,
  useDocPeaks,
  useSignedUrl,
  useSignedUrls,
  useTaskFolder,
} from "./use-task-folder"
import { SrtSettingsDialog } from "./settings-dialog"
import { useAutosave, type SaveState } from "./use-autosave"
import type { FolderEntry } from "./use-task-folder"

/**
 * Редактор титров по дорожкам персонажей.
 *
 * Раскладка — зоны из §13: топбар, превью и список реплик в одной строке,
 * таймлиния во всю ширину под ними. Скроллятся панели, страница — никогда
 * ([UI_GUIDE §8.2](../../../../docs/UI_GUIDE.md)).
 */
export function SrtEditor({ tool }: { tool: ToolInstance }) {
  const { t, lang: uiLang } = useWorkspace()
  const { closeTool } = useTools()
  const { state } = useTaskFolder(tool)

  const loaded = state.kind === "ready" ? state.doc : null
  const { doc, apply, reset, undo, redo, version } = useUndoableDoc(loaded)

  /**
   * Автосохранение. Правки уходят в папку сами: инструмент работает только
   * онлайн, и папка в хранилище — единственное место, где живут файлы.
   */
  const save = useAutosave({
    toolId: tool.id,
    doc,
    version,
    revision: loaded?.revision ?? 0,
    onMerged: reset,
    networkError: t.driveUnavailable,
  })

  // Загрузка документа — не правка человека: помечаем чистым, иначе инструмент
  // запишет в папку только что прочитанный файл.
  const markClean = save.markClean
  useEffect(() => {
    reset(loaded)
    markClean()
  }, [loaded, markClean, reset])

  // Замечания разбора показываем один раз при открытии: это не ошибки, работать
  // можно, но знать о них человек должен (§6 контракта, пункты 6 и 7).
  const warned = useRef<string | null>(null)
  useEffect(() => {
    if (state.kind !== "ready" || warned.current === state.doc.id) return
    warned.current = state.doc.id
    for (const warning of state.warnings) {
      if (warning.kind === "beyondDuration") {
        toast.warning(tf(t.srtWarnBeyondDuration, { count: warning.count }))
      } else {
        toast.warning(tf(t.srtWarnExtraLanguages, { langs: warning.langs.join(", ") }))
      }
    }
  }, [state, t.srtWarnBeyondDuration, t.srtWarnExtraLanguages])

  useEffect(() => {
    if (save.state.kind !== "merged") return
    toast.info(
      tf(t.srtSaveMergedNote, {
        taken: save.state.taken,
        conflicts: save.state.conflicts,
      }),
    )
  }, [save.state, t.srtSaveMergedNote])

  const { prefs, setPref, resetPrefs } = useViewPrefs(tool.id)
  const left = useDragSize({
    initial: DEFAULT_LEFT_W,
    min: 320,
    max: 760,
    axis: "x",
    storageKey: `ffworks-srt-left:${tool.id}`,
  })
  const bottom = useDragSize({
    initial: DEFAULT_TIMELINE_H,
    min: 160,
    max: 700,
    axis: "y",
    invert: true,
    storageKey: `ffworks-srt-timeline:${tool.id}`,
  })

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const nextId = useRef(0)

  const [tool_, setTool] = useState<TimelineTool>("select")
  const [lang, setLang] = useState<string | null>(null)
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null)
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [cueQuery, setCueQuery] = useState("")
  const [trackQuery, setTrackQuery] = useState("")
  const [hideShy, setHideShy] = useState(false)
  const [flags, setFlags] = useState<Record<string, TrackFlags>>({})
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const durationMs = doc ? docDurationMs(doc) : 0
  const clock = usePlayerClock(videoRef, durationMs)

  const projectId = tool.source?.projectId ?? null
  const folderPath = tool.source?.folderPath ?? null
  const entries = state.kind === "ready" ? state.entries : []
  const videoEntry = doc && folderPath ? findEntry(entries, folderPath, doc.media.video) : null
  const videoUrl = useSignedUrl(projectId, videoEntry?.s3Key ?? null)
  const peaks = useDocPeaks(projectId, folderPath, entries, doc)

  /**
   * Матрица звука (§15.3), в том виде, в каком её описал владелец: по
   * умолчанию звучит основная дорожка — звук видео, дорожки персонажей молчат.
   * Включили solo — видео заглушено, звучат только выбранные дорожки, и только
   * если у них вообще есть свой звук.
   */
  const soloTracks = useMemo(() => {
    if (!doc) return []
    return doc.tracks.filter((track) => {
      const flag = flags[track.id]
      return Boolean(flag?.solo) && !flag?.mute && Boolean(track.audio)
    })
  }, [doc, flags])
  const anySolo = useMemo(
    () => (doc ? doc.tracks.some((track) => flags[track.id]?.solo) : false),
    [doc, flags],
  )
  const trackAudioEntries = useMemo(() => {
    if (!folderPath) return []
    return soloTracks
      .map((track) => ({ id: track.id, entry: findEntry(entries, folderPath, track.audio) }))
      .filter((item): item is { id: string; entry: FolderEntry } => Boolean(item.entry?.s3Key))
  }, [entries, folderPath, soloTracks])
  const trackAudioUrls = useSignedUrls(
    projectId,
    trackAudioEntries.map((item) => item.entry.s3Key ?? ""),
  )

  // Дорожки заводятся из документа: solo, mute и shy — состояние вида, в файл
  // они не пишутся (§15.3), но появиться должны сразу, а не по первому клику.
  useEffect(() => {
    if (!doc) return
    setFlags((current) => {
      let changed = false
      const next = { ...current }
      for (const track of doc.tracks) {
        if (!next[track.id]) {
          next[track.id] = { solo: false, mute: false, shy: false, wave: true }
          changed = true
        }
      }
      return changed ? next : current
    })
    setSelectedTrackId((current) => current ?? doc.tracks[0]?.id ?? null)
  }, [doc])

  /** Идентификатор для новой записи: `c_` у реплики, `t_` у дорожки (§2.3). */
  const makeId = useCallback((prefix: "c" | "t") => {
    nextId.current += 1
    return `${prefix}_l${Date.now().toString(36)}${nextId.current.toString(36)}`
  }, [])

  const selectCue = useCallback(
    (cueId: string, options?: { seek?: boolean }) => {
      setSelectedCueId(cueId)
      const cue = doc?.cues.find((c) => c.id === cueId)
      if (!cue) return
      setSelectedTrackId(cue.trackId)
      if (options?.seek !== false) clock.seek(cue.startMs)
    },
    [clock, doc],
  )

  const visibleTracks = useMemo(() => {
    if (!doc) return []
    const query = trackQuery.trim().toLowerCase()
    return doc.tracks.filter(
      (track) =>
        (!hideShy || !flags[track.id]?.shy) &&
        (!query || track.name.toLowerCase().includes(query)),
    )
  }, [doc, flags, hideShy, trackQuery])

  const rows = useMemo(() => {
    if (!doc) return []
    const query = cueQuery.trim().toLowerCase()
    if (!query) return doc.cues
    return doc.cues.filter((cue) => {
      const translations = Object.values(cue.tr).map((tr) => tr.text).join(" ")
      return `${cue.text} ${translations}`.toLowerCase().includes(query)
    })
  }, [cueQuery, doc])

  const ops = useMemo<SrtApi["ops"]>(
    () => ({
      setText: (cueId, text) => apply((d) => setCueText(d, cueId, text)),
      setTranslation: (cueId, language, text) =>
        apply((d) => setCueTranslation(d, cueId, language, text)),
      setTiming: (cueId, startMs, endMs, trackId, gesture) =>
        apply((d) => {
          const moved = setCueTiming(d, cueId, startMs, endMs)
          // Перенос на другую дорожку — не то же, что сдвиг во времени: он
          // запоминает, куда автоматика приписала реплику изначально.
          return trackId ? moveCueToTrack(moved, cueId, trackId) : moved
        }, gesture),
      addCue: (trackId, startMs, endMs) => {
        const id = makeId("c")
        apply((d) => addCueOp(d, trackId, startMs, endMs, id))
        return id
      },
      removeCue: (cueId) => {
        apply((d) => removeCueOp(d, cueId, new Date().toISOString()))
        setSelectedCueId((current) => (current === cueId ? null : current))
      },
      splitCue: (cueId, atMs) => apply((d) => splitCueOp(d, cueId, atMs, makeId("c"))),
      mergeNext: (cueId) => apply((d) => mergeCueWithNext(d, cueId)),
      mergeCues: (aId, bId) => apply((d) => mergeCuesOp(d, aId, bId)),
      renameTrack: (trackId, name) => apply((d) => renameTrackOp(d, trackId, name)),
      setTrackColor: (trackId, color) => apply((d) => setTrackColorOp(d, trackId, color)),
      addLanguage: (code) => {
        apply((d) => addLanguageOp(d, code))
        setLang(code.trim().toLowerCase())
      },
      removeLanguage: (code) => {
        apply((d) => removeLanguageOp(d, code))
        setLang((current) => (current === code ? null : current))
      },
      addTrack: () => apply((d) => addTrackOp(d, makeId("t"), t.srtNewTrack)),
      undo,
      redo,
    }),
    [apply, makeId, redo, t.srtNewTrack, undo],
  )

  const held = useHeldTool(tool_, setTool)

  /** Код физической кнопки → действие. Пересобирается при переназначении. */
  const actionByCode = useMemo(() => {
    const map = new Map<string, HotkeyAction>()
    for (const [action, code] of Object.entries(prefs.keymap)) {
      map.set(code, action as HotkeyAction)
    }
    return map
  }, [prefs.keymap])

  // Горячие клавиши. Внутри полей ввода не работают: там буквы принадлежат
  // тексту, а не инструменту (§18.4). Клавиша опознаётся по `event.code` —
  // по физической кнопке, поэтому русская раскладка ничего не ломает.
  useEffect(() => {
    const editable = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (editable(event.target)) return

      // При открытом окне клавиши принадлежат ему: Space в настройках должен
      // нажимать кнопку под курсором, а не запускать воспроизведение.
      if (settingsOpen || helpOpen) {
        if (event.code === "Escape") {
          setHelpOpen(false)
          setSettingsOpen(false)
          event.preventDefault()
        }
        return
      }

      if (event.metaKey || event.ctrlKey) {
        if (event.code === "KeyS") {
          event.preventDefault()
          save.flush()
          return
        }
        if (event.code !== "KeyZ") return
        event.preventDefault()
        if (event.shiftKey) ops.redo()
        else ops.undo()
        return
      }

      const action = actionByCode.get(event.code)
      if (
        action === "select" ||
        action === "create" ||
        action === "razor" ||
        action === "shift" ||
        action === "merge"
      ) {
        held.press(event.code, action, event.repeat)
        event.preventDefault()
        return
      }
      if (action === "playPause") {
        clock.togglePlay()
      } else if (action === "mainWave") {
        setPref("mainWave", !prefs.mainWave)
      } else if (event.code === "Delete" || event.code === "Backspace") {
        if (selectedCueId) ops.removeCue(selectedCueId)
      } else if (event.code === "Equal" || event.code === "NumpadAdd") {
        setPref("zoom", zoomStep(prefs.zoom, 1))
      } else if (event.code === "Minus" || event.code === "NumpadSubtract") {
        setPref("zoom", zoomStep(prefs.zoom, -1))
      } else if (event.code === "F1") {
        setHelpOpen(true)
      } else if (event.code === "Escape") {
        setHelpOpen(false)
        setSettingsOpen(false)
      } else {
        return
      }
      event.preventDefault()
    }

    const onKeyUp = (event: KeyboardEvent) => held.release(event.code)

    window.addEventListener("keydown", onKeyDown)
    // `keyup` слушаем без оглядки на цель: клавишу могли отпустить, уже уведя
    // фокус в поле, и тогда временный инструмент завис бы включённым.
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [
    actionByCode,
    clock,
    held,
    helpOpen,
    ops,
    prefs.mainWave,
    prefs.zoom,
    save,
    selectedCueId,
    setPref,
    settingsOpen,
  ])

  const exportFile = useCallback(() => {
    if (!doc) return
    const result = exportDocument(doc, prefs.exportFmt, { lang })
    const blob = new Blob([result.text], { type: result.mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    const base = folderPath?.split("/").pop() ?? doc.id
    link.href = url
    link.download = `${base}.${lang ?? doc.languages.original}.${result.extension}`
    link.click()
    URL.revokeObjectURL(url)
  }, [doc, folderPath, lang, prefs.exportFmt])

  const api = useMemo<SrtApi | null>(() => {
    if (!doc) return null
    return {
      doc,
      durationMs,
      mediaEndMs: doc.media.durationMs || durationMs,
      prefs,
      setPref,
      resetView: () => {
        resetPrefs()
        left.setSize(DEFAULT_LEFT_W)
        bottom.setSize(DEFAULT_TIMELINE_H)
      },
      pps: prefs.zoom,
      setPps: (value) => setPref("zoom", Math.min(MAX_PPS, Math.max(MIN_PPS, value))),
      tool: tool_,
      setTool,
      lang,
      setLang,
      selectedCueId,
      selectedTrackId,
      selectCue,
      selectTrack: setSelectedTrackId,
      cueQuery,
      setCueQuery,
      trackQuery,
      setTrackQuery,
      hideShy,
      setHideShy,
      flags,
      toggleFlag: (trackId, key) =>
        setFlags((current) => ({
          ...current,
          [trackId]: {
            ...(current[trackId] ?? { solo: false, mute: false, shy: false, wave: true }),
            [key]: !current[trackId]?.[key],
          },
        })),
      clock,
      videoUrl,
      soloTrackIds: trackAudioEntries.map((item) => item.id),
      mainMuted: anySolo,
      trackAudioUrl: (trackId) => {
        const key = trackAudioEntries.find((item) => item.id === trackId)?.entry.s3Key
        return key ? trackAudioUrls[key] ?? null : null
      },
      peaksFor: (trackId) => {
        const own = peaks.byTrack[trackId]
        return own ? { peaks: own, own: true } : { peaks: peaks.main, own: false }
      },
      mainPeaks: peaks.main,
      visibleTracks,
      rows,
      ops,
      openSettings: () => setSettingsOpen(true),
      openHelp: () => setHelpOpen(true),
    }
  }, [
    anySolo,
    bottom,
    clock,
    cueQuery,
    doc,
    durationMs,
    flags,
    hideShy,
    lang,
    left,
    ops,
    peaks,
    prefs,
    resetPrefs,
    rows,
    selectCue,
    selectedCueId,
    selectedTrackId,
    setPref,
    tool_,
    trackAudioEntries,
    trackAudioUrls,
    trackQuery,
    videoUrl,
    visibleTracks,
  ])

  return (
    <section ref={rootRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 flex-none items-center gap-2.5 border-b border-white/[0.07] px-3 md:px-4">
        <SourcePicker tool={tool} />
        <button
          type="button"
          title={t.srtSettings}
          onClick={() => setSettingsOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-md border border-white/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <Settings className="h-[17px] w-[17px]" />
        </button>

        {doc ? (
          <div className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-ws-raised p-[3px]">
            <LangTab active={lang === null} label={t.srtColOriginal} onClick={() => setLang(null)} />
            {doc.languages.targets.map((code) => (
              <LangTab
                key={code}
                active={lang === code}
                title={languageName(code, uiLang)}
                label={
                  doc.languages.targets.length > 1 ? code.toUpperCase() : t.srtColTranslation
                }
                onClick={() => setLang(code)}
              />
            ))}
            {/*
              Кнопка есть всегда, даже когда переводов в папке нет: перевод тут
              не только правят, но и пишут с нуля — а писать некуда, пока не
              сказано, на каком языке.
            */}
            <LanguagePicker
              taken={doc.languages.targets}
              original={doc.languages.original}
              onPick={(code) => ops.addLanguage(code)}
              onRemove={(code) => ops.removeLanguage(code)}
            />
          </div>
        ) : null}

        <div className="flex-1" />

        {doc ? (
          <span className="hidden items-center gap-1.5 font-mono text-[12px] tabular-nums text-ws-3 xl:flex">
            <Captions className="h-4 w-4 text-ws-5" />
            {tf(t.srtCounters, { cues: doc.cues.length, tracks: doc.tracks.length })}
          </span>
        ) : null}

        {doc ? <SaveBadge state={save.state} dirty={save.dirty} onFlush={save.flush} /> : null}

        <button
          type="button"
          title={t.srtHotkeys}
          onClick={() => setHelpOpen(true)}
          className="flex h-[34px] w-[34px] items-center justify-center rounded border border-white/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <HelpCircle className="h-[18px] w-[18px]" />
        </button>
        <button
          type="button"
          onClick={exportFile}
          disabled={!doc}
          className="flex h-[34px] items-center gap-2 rounded border border-white/[0.07] px-3 text-[13px] text-ws-2 hover:bg-ws-hover disabled:opacity-40"
        >
          <Download className="h-[17px] w-[17px]" />
          {t.srtExport}
        </button>
        <button
          type="button"
          title={t.toolClose}
          onClick={closeTool}
          className="flex h-[34px] w-[34px] items-center justify-center rounded border border-white/[0.07] text-ws-3 hover:bg-ws-hover hover:text-ws-1"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </header>

      {api ? (
        <SrtProvider value={api}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1">
              <div className="relative flex-none" style={{ width: left.size }}>
                <PreviewPane videoRef={videoRef} />
                <ResizeGrip
                  orientation="vertical"
                  side="right"
                  label={t.srtResizePreview}
                  dragging={left.dragging}
                  onPointerDown={left.onPointerDown}
                  onKeyDown={left.onKeyDown}
                  // Ручка сидит верхом на границе зон, а не поверх соседа:
                  // иначе она перехватывает клики по краю списка реплик.
                  className="right-[-5px]"
                />
              </div>
              <CueList />
            </div>
            <div className="relative flex-none" style={{ height: bottom.size }}>
              <ResizeGrip
                orientation="horizontal"
                side="top"
                label={t.srtResizeTimeline}
                dragging={bottom.dragging}
                onPointerDown={bottom.onPointerDown}
                onKeyDown={bottom.onKeyDown}
                className="top-[-5px]"
              />
              <TimelinePane />
            </div>
          </div>
        </SrtProvider>
      ) : (
        <EmptyArea state={state} />
      )}

      <SrtSettingsDialog
        tool={tool}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prefs={prefs}
        setPref={setPref}
        resetView={() => {
          resetPrefs()
          left.setSize(DEFAULT_LEFT_W)
          bottom.setSize(DEFAULT_TIMELINE_H)
        }}
        onOpenHelp={() => {
          setSettingsOpen(false)
          setHelpOpen(true)
        }}
      />
      <SrtHelpDialog open={helpOpen} onOpenChange={setHelpOpen} keymap={prefs.keymap} />
    </section>
  )
}

/**
 * Состояние записи.
 *
 * Отдельная строка в топбаре, а не тихая работа в фоне: человек правит чужой
 * материал в чужой папке и должен видеть, что правки доехали. Кнопка «сохранить
 * сейчас» появляется, когда есть что записывать, — на случай, когда ждать
 * затишья не хочется.
 */
function SaveBadge({
  state,
  dirty,
  onFlush,
}: {
  state: SaveState
  dirty: boolean
  onFlush: () => void
}) {
  const { t } = useWorkspace()

  const view =
    state.kind === "saving"
      ? { icon: Loader2, text: t.srtSaveSaving, tone: "text-ws-3", spin: true }
      : state.kind === "error"
        ? { icon: CloudOff, text: t.srtSaveError, tone: "text-ws-playhead", spin: false }
        : state.kind === "merged"
          ? { icon: TriangleAlert, text: t.srtSaveMerged, tone: "text-[#e0a33a]", spin: false }
          : dirty || state.kind === "pending"
            ? { icon: TriangleAlert, text: t.srtSavePending, tone: "text-ws-4", spin: false }
            : { icon: Check, text: t.srtSaveClean, tone: "text-ws-out", spin: false }
  const Icon = view.icon

  return (
    <button
      type="button"
      onClick={onFlush}
      disabled={!dirty && state.kind !== "error"}
      title={state.kind === "error" ? state.message : t.srtSaveNow}
      className={cn(
        "flex h-[34px] items-center gap-1.5 rounded px-2 text-[12px]",
        view.tone,
        dirty || state.kind === "error" ? "hover:bg-ws-hover" : "cursor-default",
      )}
    >
      <Icon className={cn("h-4 w-4", view.spin && "animate-spin")} />
      <span className="hidden lg:inline">{view.text}</span>
    </button>
  )
}

function LangTab({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean
  label: string
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "h-[26px] rounded px-2.5 text-[12px] font-semibold",
        active ? "bg-ws-action text-white" : "text-ws-3 hover:text-ws-1",
      )}
    >
      {label}
    </button>
  )
}

/** Пока документа нет: приглашение выбрать папку, ожидание или ошибка. */
function EmptyArea({ state }: { state: ReturnType<typeof useTaskFolder>["state"] }) {
  const { t } = useWorkspace()

  if (state.kind === "loading") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-ws-4" />
      </div>
    )
  }
  if (state.kind === "error") {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6">
        <p className="flex max-w-[460px] items-start gap-2.5 text-[13.5px] leading-relaxed text-ws-3">
          <AlertTriangle className="mt-[2px] h-[17px] w-[17px] shrink-0 text-ws-playhead" />
          <span>{state.message}</span>
        </p>
      </div>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6">
      <p className="max-w-[420px] text-center text-[14px] leading-relaxed text-ws-4">
        {t.toolNoSource} — {t.toolPickSource.toLowerCase()}
      </p>
    </div>
  )
}
