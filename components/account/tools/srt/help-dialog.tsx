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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { keyLabel, type Keymap } from "./editor-state"

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

  const rows = [
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[82vh] w-[640px] max-w-[92vw] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-none border-b border-white/[0.07] px-5 py-4">
          <DialogTitle className="text-[16px] font-semibold">{t.srtHotkeysTitle}</DialogTitle>
        </DialogHeader>
        <div className="scrollbar-elegant min-h-0 flex-1 overflow-y-auto px-5 pb-4 pt-2">
          {rows.map((row) => {
            const Icon = row.icon
            return (
              <div
                key={row.title}
                className="grid grid-cols-[26px_120px_1fr] items-start gap-3 border-b border-white/[0.06] py-3 last:border-b-0"
              >
                <Icon className="h-[19px] w-[19px] text-ws-accent" />
                <div className="flex">
                  <kbd className="whitespace-nowrap rounded border border-white/[0.10] bg-ws-well px-2 py-[2px] font-mono text-[12px] text-ws-2">
                    {row.key}
                  </kbd>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-ws-1">{row.title}</span>
                  <span className="text-pretty text-[12px] leading-relaxed text-ws-3">
                    {row.desc}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
