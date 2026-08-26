"use client"

import {
  AudioLines,
  Ear,
  Gauge,
  Keyboard,
  Mic,
  Mouse,
  MousePointerClick,
  MoveHorizontal,
  Play,
  RotateCcw,
  Trash2,
  Volume2,
  X,
  ZoomIn,
} from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { keyLabel } from "../shared/editor-state"
import { ToolHelpDialog, type HelpRow } from "../shared/help-dialog"
import type { VoiceKeymap } from "./prefs"

/**
 * Справка инструмента озвучки.
 *
 * Строк меньше, чем у титров, и половина из них — не клавиши, а движения мышью:
 * подстройка тейка делается прямо на клипе, и без подсказки об этом не
 * догадаться.
 */
export function VoiceHelpDialog({
  open,
  onOpenChange,
  keymap,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keymap: VoiceKeymap
}) {
  const { t } = useWorkspace()

  const rows: HelpRow[] = [
    {
      icon: Mic,
      key: keyLabel(keymap.generate),
      title: t.voiceHelpGenerateTitle,
      desc: t.voiceHelpGenerateDesc,
    },
    {
      icon: Gauge,
      key: keyLabel(keymap.fit),
      title: t.voiceHelpFitTitle,
      desc: t.voiceHelpFitDesc,
    },
    {
      icon: Play,
      key: keyLabel(keymap.playPause),
      title: t.srtHelpPlayTitle,
      desc: t.srtHelpPlayDesc,
    },
    {
      icon: Ear,
      key: keyLabel(keymap.original),
      title: t.voiceHelpListenTitle,
      desc: t.voiceHelpListenDesc,
    },
    {
      icon: AudioLines,
      key: keyLabel(keymap.mainWave),
      title: t.srtHelpWaveTitle,
      desc: t.srtHelpWaveDesc,
    },
    {
      icon: MoveHorizontal,
      key: t.voiceKeyDrag,
      title: t.voiceHelpMoveTitle,
      desc: t.voiceHelpMoveDesc,
    },
    {
      icon: Gauge,
      key: t.voiceKeyDragEdge,
      title: t.voiceHelpRateTitle,
      desc: t.voiceHelpRateDesc,
    },
    {
      icon: Volume2,
      key: t.voiceKeyGainBar,
      title: t.voiceHelpGainTitle,
      desc: t.voiceHelpGainDesc,
    },
    {
      icon: RotateCcw,
      key: t.voiceKeyDoubleClick,
      title: t.voiceHelpResetTitle,
      desc: t.voiceHelpResetDesc,
    },
    { icon: Mouse, key: t.srtKeyWheel, title: t.srtHelpWheelTitle, desc: t.srtHelpWheelDesc },
    { icon: ZoomIn, key: "+ / −", title: t.srtHelpZoomTitle, desc: t.srtHelpZoomDesc },
    {
      icon: MousePointerClick,
      key: t.srtKeyClick,
      title: t.srtHelpGotoTitle,
      desc: t.srtHelpGotoDesc,
    },
    {
      icon: Trash2,
      key: keyLabel(keymap.removeTake),
      title: t.voiceHelpDeleteTitle,
      desc: t.voiceHelpDeleteDesc,
    },
    {
      icon: Trash2,
      key: `Shift + ${keyLabel(keymap.removeTake)}`,
      title: t.voiceHelpDeleteAllTitle,
      desc: t.voiceHelpDeleteAllDesc,
    },
    { icon: Keyboard, key: "F1", title: t.srtHelpHelpTitle, desc: t.srtHelpHelpDesc },
    { icon: X, key: "Esc", title: t.voiceHelpEscTitle, desc: t.voiceHelpEscDesc },
  ]

  return <ToolHelpDialog open={open} onOpenChange={onOpenChange} rows={rows} />
}
