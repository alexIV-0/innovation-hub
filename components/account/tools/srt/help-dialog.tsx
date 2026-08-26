"use client"

import {
  ArrowUpDown,
  AudioLines,
  Hand,
  ChevronsRightLeft,
  Keyboard,
  Mouse,
  MousePointer2,
  MousePointerClick,
  Play,
  Scissors,
  SquarePlus,
  Trash2,
  X,
  ZoomIn,
} from "lucide-react"

import { useWorkspace } from "@/components/account/workspace/workspace-context"
import { keyLabel } from "../shared/editor-state"
import { ToolHelpDialog, type HelpRow } from "../shared/help-dialog"
import { type Keymap } from "./prefs"

/** Справка по инструментам и клавишам. Открывается по F1 и из настроек. */
export function SrtHelpDialog({
  open,
  onOpenChange,
  keymap,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  keymap: Keymap
}) {
  const { t } = useWorkspace()

  const rows: HelpRow[] = [
    {
      icon: MousePointer2,
      key: keyLabel(keymap.select),
      title: t.srtHelpSelectTitle,
      desc: t.srtHelpSelectDesc,
    },
    {
      icon: SquarePlus,
      key: keyLabel(keymap.create),
      title: t.srtHelpCreateTitle,
      desc: t.srtHelpCreateDesc,
    },
    {
      icon: Scissors,
      key: keyLabel(keymap.razor),
      title: t.srtHelpRazorTitle,
      desc: t.srtHelpRazorDesc,
    },
    {
      icon: ArrowUpDown,
      key: keyLabel(keymap.shift),
      title: t.srtHelpShiftTitle,
      desc: t.srtHelpShiftDesc,
    },
    {
      icon: ChevronsRightLeft,
      key: keyLabel(keymap.merge),
      title: t.srtHelpMergeTitle,
      desc: t.srtHelpMergeDesc,
    },
    {
      icon: Play,
      key: keyLabel(keymap.playPause),
      title: t.srtHelpPlayTitle,
      desc: t.srtHelpPlayDesc,
    },
    { icon: ZoomIn, key: "+ / −", title: t.srtHelpZoomTitle, desc: t.srtHelpZoomDesc },
    { icon: Mouse, key: t.srtKeyWheel, title: t.srtHelpWheelTitle, desc: t.srtHelpWheelDesc },
    {
      icon: MousePointerClick,
      key: t.srtKeyClick,
      title: t.srtHelpGotoTitle,
      desc: t.srtHelpGotoDesc,
    },
    {
      icon: AudioLines,
      key: keyLabel(keymap.mainWave),
      title: t.srtHelpWaveTitle,
      desc: t.srtHelpWaveDesc,
    },
    { icon: Keyboard, key: "F1", title: t.srtHelpHelpTitle, desc: t.srtHelpHelpDesc },
    { icon: Trash2, key: "Delete", title: t.srtHelpDeleteTitle, desc: t.srtHelpDeleteDesc },
    { icon: Hand, key: t.srtKeyHold, title: t.srtHelpHoldTitle, desc: t.srtHelpHoldDesc },
    { icon: X, key: "Esc", title: t.srtHelpEscTitle, desc: t.srtHelpEscDesc },
  ]

  return <ToolHelpDialog open={open} onOpenChange={onOpenChange} rows={rows} />
}
