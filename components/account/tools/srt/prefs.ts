"use client"

/**
 * Настройки вида и раскладка клавиш редактора титров.
 *
 * Здесь то, что относится только к этому инструменту: набор инструментов
 * таймлинии, действия с горячими клавишами и состав настроек. Общее —
 * в `../shared/editor-state.ts`.
 */

import type { ExportFormat } from "@/lib/tools/dialog/export"

/** Инструмент таймлинии: выделение, создание, разрез, перенос, объединение. */
export type TimelineTool = "select" | "create" | "razor" | "shift" | "merge"

/** Действия, у которых есть горячая клавиша и которые можно переназначить. */
export type HotkeyAction = TimelineTool | "playPause" | "mainWave"

export const HOTKEY_ACTIONS: HotkeyAction[] = [
  "select",
  "create",
  "razor",
  "shift",
  "merge",
  "playPause",
  "mainWave",
]

/**
 * Клавиши хранятся кодом физической кнопки (`KeyB`), а не набранным символом.
 *
 * `event.key` зависит от раскладки: на русской та же кнопка даёт «и», и
 * привязка к букве просто перестаёт работать, пока не переключишь язык.
 * `event.code` описывает кнопку, поэтому раскладку можно не трогать.
 */
export type Keymap = Record<HotkeyAction, string>

export const DEFAULT_KEYMAP: Keymap = {
  select: "KeyV",
  create: "KeyC",
  razor: "KeyB",
  shift: "KeyM",
  merge: "KeyJ",
  playPause: "Space",
  mainWave: "KeyW",
}

export type ViewPrefs = {
  trackH: number
  fontSize: number
  snap: boolean
  exportFmt: ExportFormat
  mainWave: boolean
  zoom: number
  keymap: Keymap
}

export const DEFAULT_PREFS: ViewPrefs = {
  trackH: 52,
  fontSize: 14,
  snap: true,
  exportFmt: "srt",
  mainWave: true,
  zoom: 64,
  keymap: DEFAULT_KEYMAP,
}

/** Размеры зон по умолчанию — из дизайна. */
export const DEFAULT_LEFT_W = 420
export const DEFAULT_TIMELINE_H = 300


/** Ключ, под которым настройки вида лежат в `localStorage`. */
export function viewPrefsKey(toolId: string): string {
  return `ffworks-srt-view:${toolId}`
}
