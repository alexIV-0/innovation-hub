"use client"

import { Captions, Mic, Wrench, type LucideIcon } from "lucide-react"

import type { DictKey } from "@/components/account/i18n"
import type { ToolKind } from "@/lib/tools/registry"

/**
 * Клиентская половина реестра: иконки и ключи словаря.
 *
 * Отдельно от `lib/tools/registry.ts`, потому что тот читают серверные роуты, и
 * тащить в них React-компоненты незачем. Здесь связь «ключ инструмента → как его
 * показать», и она обязана покрывать каждый инструмент реестра.
 */

const ICONS: Record<string, LucideIcon> = {
  captions: Captions,
  mic: Mic,
}

export function toolIcon(icon: string): LucideIcon {
  return ICONS[icon] ?? Wrench
}

type ToolText = { name: DictKey; short: DictKey; long: DictKey }

const TEXT: Record<string, ToolText> = {
  "srt-editor": {
    name: "toolSrtEditorName",
    short: "toolSrtEditorShort",
    long: "toolSrtEditorLong",
  },
  "voice-over": {
    name: "toolVoiceOverName",
    short: "toolVoiceOverShort",
    long: "toolVoiceOverLong",
  },
}

/** Ключи словаря для инструмента. Незнакомый ключ — видимая заглушка, не падение. */
export function toolText(key: string): ToolText {
  return TEXT[key] ?? { name: "toolsTab", short: "toolsTab", long: "toolsTab" }
}

export const KIND_LABEL: Record<ToolKind, DictKey> = {
  srt: "kindSrt",
  video: "kindVideo",
  audio: "kindAudio",
  text: "kindText",
  image: "kindImage",
  data: "kindData",
}
